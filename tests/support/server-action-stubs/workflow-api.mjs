// workflow/api without the Workflow runtime: start() calls whatever the test
// set as globalThis.__workflowStart, or fails as an unavailable runtime would
// (so callers take their inline fallback).
export async function start(workflow, args) {
  const impl = globalThis.__workflowStart;
  if (!impl) throw new Error("Workflow runtime unavailable in tests");
  return impl(workflow, args);
}
