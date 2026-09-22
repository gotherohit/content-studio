/** Bounded, model-authored progress; never used as authorization to execute tools. */
export function validatePlan(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 12) throw new Error("A plan needs 1–12 steps.");
  const plan = steps.map((step) => {
    if (!step || typeof step.text !== "string" || !step.text.trim() || step.text.length > 200 || !["pending", "in_progress", "complete"].includes(step.status)) throw new Error("Each plan step needs text (up to 200 characters) and a valid status.");
    return { text: step.text.trim(), status: step.status };
  });
  if (plan.filter((step) => step.status === "in_progress").length > 1) throw new Error("Only one plan step can be in progress.");
  return plan;
}
