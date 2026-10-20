import { callDbFunction, selectRow, updateProfileColumns } from "../src/lib/db-privileged";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

export async function runPrivilegedIdentifierTests(assert: Assert, section: Section) {
  section("Privileged SQL identifier validation");

  const rejects = async (operation: Promise<unknown>, name: string) => {
    let rejected = false;
    try {
      await operation;
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("Invalid");
    }
    assert(rejected, name);
  };

  await rejects(callDbFunction("revoke_all_sessions; drop table profiles; --", []), "rejects unexpected function names before execution");
  await rejects(callDbFunction("", []), "rejects empty function names before execution");
  await rejects(selectRow("profiles", "id = $1; drop table profiles; --", "u1"), "rejects injected profile columns before execution");
  await rejects(selectRow("invitations", "email", "a@example.com"), "rejects unsupported invitation columns");
  await rejects(updateProfileColumns("u1", { "status = 'owner' --": "active" }), "rejects injected update fields before execution");
  await rejects(updateProfileColumns("u1", { unknown_field: true }), "rejects unknown update fields");
  await rejects(updateProfileColumns("u1", { "": true }), "rejects empty update fields");

  const functionResult = await callDbFunction("revoke_all_sessions", []);
  assert(functionResult.ok === false && functionResult.error === "unavailable", "supports the existing revoke_all_sessions function identifier");
  assert((await selectRow("profiles", "id", "u1")) === null, "supports the existing profiles.id lookup");
  assert((await selectRow("invitations", "token", "token")) === null, "supports the existing invitations.token lookup");
  assert((await updateProfileColumns("u1", { status: "active", access_revoked_at: null, can_request_invites: false })) === false, "supports every existing profile update field");
}
