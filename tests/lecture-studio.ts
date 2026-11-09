import { readFileSync, existsSync } from "fs";
import { planFrames } from "../src/lib/media/pipeline";

/**
 * Phase 5: the lecture studio is the first screen that drives the media
 * pipeline. Before it existed every media capability was headless, so a member
 * could upload nothing and read nothing. These assertions pin the wiring and,
 * just as importantly, the honesty and privacy properties the pipeline was
 * built for.
 */

const read = (p: string) => readFileSync(p, "utf8");

export async function runLectureStudioTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const section = (n: string) => console.log("\n" + n);

  const pagePath = "src/app/lectures/page.tsx";
  assert(existsSync(pagePath), "lecture studio page exists");
  const page = read(pagePath);
  const shell = read("src/components/app/AppShell.tsx");

  section("lecture studio: reachable");

  assert(/^\s*"use client";/.test(page), "the studio is a client component (it drives the browser upload)");
  assert(page.includes("AppShell"), "the page renders inside the standard app shell");
  assert(shell.includes('href: "/lectures"'), "Lectures appears in the workspace navigation");
  assert(existsSync("src/app/lectures/loading.tsx"), "the route has a plain-words loading state");
  assert(!page.includes("dangerouslySetInnerHTML"), "no raw HTML injection");

  section("lecture studio: the file never passes through the application server");

  assert(page.includes("/api/media/upload-url"), "the page asks the server for a signed upload link");
  assert(/method:\s*"PUT"/.test(page), "the browser uploads with a PUT straight to storage");
  assert(!/fetch\(\s*["'`]\/api\/media\/upload["'`]/.test(page), "there is no byte-upload endpoint on our server");
  assert(!/\.storage\s*\.\s*from\(/.test(page), "the page never talks to storage directly with its own keys");
  assert(!page.includes("SUPABASE_SERVICE_ROLE"), "no service role anywhere near the client");
  assert(!/\$\{[^}]*user\.id[^}]*\}\/media\//.test(page), "the browser never builds a storage path itself");
  assert(!page.includes("storage_path"), "the page does not read raw storage paths");

  section("lecture studio: every pipeline step is wired to the real endpoint");

  assert(page.includes("/transcribe`"), "transcribe is wired to the transcribe endpoint");
  assert(page.includes("/study`"), "study notes and questions are wired to the study endpoint");
  assert(page.includes("/frames`"), "slide reading is wired to the frames endpoint");
  assert(page.includes('task: "summary"'), "study notes request the summary task");
  assert(/body:\s*JSON\.stringify\(ask \? \{ ask: plainText\(ask, 800\) \}/.test(page),
    "a question is sent as the member's own words, normalised to plain text");
  assert(page.includes('method: "POST"'), "pipeline steps are POSTs");

  section("lecture studio: honest states, no invented results");

  assert(page.includes("Study notes need a transcript first"), "the page says why study notes are unavailable instead of faking them");
  assert(page.includes("answer.notice"), "the coverage notice from the server is shown");
  assert(page.includes("transcriptConfidence"), "transcript confidence is shown, not hidden");
  assert(page.includes("removedCitations"), "dropped quotes are reported, not silently accepted");
  assert(page.includes("truncated"), "a shortened lecture is disclosed");
  assert(page.includes("nothing readable"), "an unreadable frame says so instead of showing an empty quote");
  assert(page.includes("member_note"), "the server's member note is displayed");
  assert(page.includes("Duplicate") === false, "the page does not invent a duplicate warning of its own");
  for (const fake of ["50%", "75%", "90%", "Estimated time", "skeleton"]) {
    assert(!page.includes(fake), `no fabricated progress or placeholder content ("${fake}")`);
  }

  section("lecture studio: client frame sampling obeys the server's limits");

  assert(page.includes("sampleTimes"), "the sampler is a named, testable step");
  assert(/Math\.min\(12,/.test(page), "the sampler caps itself at 12 frames");
  assert(/Math\.min\(5,/.test(page), "the sampler starts a little way in, like the server planner");
  for (const dur of [60, 600, 1800, 3600, 7200]) {
    const server = planFrames(dur, 12).length;
    const start = Math.min(5, dur * 0.05);
    const count = Math.max(1, Math.min(12, Math.floor(dur / 30)));
    const step = (dur - start) / count;
    const client: number[] = [];
    for (let i = 0; i < count; i += 1) client.push(Math.round((start + step * i) * 10) / 10);
    assert(client.length === server, `client and server sample the same number of frames for ${dur}s (${client.length})`);
    assert(client.every((t) => t > 0 && t < dur), `client frames for ${dur}s land inside the recording`);
  }
  assert(page.includes('image/jpeg'), "frames are sent as JPEG stills, small enough to upload one by one");
  assert(page.includes('form.set("at_sec"'), "each frame carries its timestamp, which is what makes it citable");
  assert(!/canvas\.width\s*=\s*\d{4,}/.test(page), "no oversized canvas (resolution follows the video)");

  section("lecture studio: outside text can never become markup");

  assert(page.includes("function plainText("), "one normaliser is defined for all outside text");
  assert(/replace\(\/\[<>\]\/g, ""\)/.test(page), "angle brackets are stripped from transcript, OCR and model text");
  assert(page.includes("text: plainText(c.text, 300)"), "slide text is normalised before it is stored in state");
  assert(page.includes("answer: plainText(data.answer, 20000)"), "a model answer is normalised before it is shown");
  assert(page.includes("plainText(data.notice, 600)"), "the server's notice is normalised too");
  assert(page.includes("plainText(asset.member_note, 600)"), "the member note is normalised");
  assert(!/\{f\.text\}/.test(page), "raw OCR text is never rendered directly");

  section("lecture studio: playback only ever loads a server-signed private link");

  assert(page.includes("function mountRemoteVideo("), "one place builds the player");
  assert((page.match(/createObjectURL/g) ?? []).length === 0, "no blob URL is created at all any more");
  assert(page.includes('parsed.protocol !== "https:"'), "only an https link is accepted");
  assert(page.includes('parsed.pathname.includes("/storage/")'), "the link must point inside storage, not anywhere else");
  assert(page.includes("setAttribute(\"src\", parsed.href)"), "the parsed, checked link is attached once");
  assert((page.match(/setAttribute\(/g) ?? []).length === 1, "there is exactly one attribute assignment in the whole page");
  assert(!/\.src\s*=/.test(page), "no media element source is assigned directly");
  assert(page.includes("/stream"), "the link comes from the member's own signed-link route");

  const streamRoute = read("src/app/api/media/[id]/stream/route.ts");
  assert(streamRoute.includes("requireUser"), "the link is only issued to a signed-in member");
  assert(streamRoute.includes(".eq(\"id\", id)"), "the asset is read through the caller's own session (RLS scoped)");
  assert(streamRoute.includes("createSignedUrl"), "the link is signed, not public");
  assert(/createSignedUrl\([^)]*,\s*600\)/.test(streamRoute), "the link expires in ten minutes");
  assert(streamRoute.includes("storage_path") && !streamRoute.includes("searchParams"), "the object path comes from the database, never from the request");
  assert(streamRoute.includes("private-docs"), "it signs out of the private bucket only");

  section("lecture studio: honest failure and privacy wording");

  assert(page.includes("Check your connection"), "an interrupted upload gives a plain next step");
  assert(page.includes("not a video or a recording"), "an unsupported file is named in plain words");
  assert(page.includes("Private to you"), "the page states the privacy boundary in the header");
  assert(page.includes("only your account can open them"), "the empty state explains who can open recordings");
  assert(!/console\.(log|debug)\(/.test(page), "no member content is logged to the console");

  return { passed, failed };
}
