export function applyMemoryStateToFields(memoryState = {}, fields = {}) {
  const profileValue = typeof memoryState?.profile === 'string' ? memoryState.profile : '';
  const goalsValue = Array.isArray(memoryState?.goals)
    ? memoryState.goals.filter((goal) => typeof goal === 'string').map((goal) => goal.trim()).filter(Boolean).join('\n')
    : '';
  const factsValue = Array.isArray(memoryState?.facts)
    ? memoryState.facts.filter((fact) => typeof fact === 'string').map((fact) => fact.trim()).filter(Boolean).join('\n')
    : '';

  if (fields?.profile && typeof fields.profile.value !== 'undefined') {
    fields.profile.value = profileValue;
  }

  if (fields?.goals && typeof fields.goals.value !== 'undefined') {
    fields.goals.value = goalsValue;
  }

  if (fields?.facts && typeof fields.facts.value !== 'undefined') {
    fields.facts.value = factsValue;
  }

  return {
    profileValue,
    goalsValue,
    factsValue,
  };
}
