/** Spike: one workflow with one step, to prove the Workflow SDK runs on this deployment. */
export async function pingWorkflow(n: number) {
  'use workflow';
  const doubled = await double(n);
  return { doubled };
}

async function double(n: number) {
  'use step';
  return n * 2;
}
