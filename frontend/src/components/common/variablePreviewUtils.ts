export interface ResolvedVariableInfo {
  value: string;
  source: string;
  isSecret?: boolean;
}

export type ResolvedVariableLookup = ReadonlyMap<string, ResolvedVariableInfo>;

export interface VariablePreviewResult {
  resolvedValue: string;
  displayValue: string;
  missingVariables: string[];
  sources: string[];
  hasVariables: boolean;
  hasSecrets: boolean;
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\{\s*([a-zA-Z0-9_.-]+)\s*\}/g;
const SECRET_MASK = '••••••••';

export function resolveValueForPreview(
  input: string,
  variables: ResolvedVariableLookup,
  sensitive = false,
): VariablePreviewResult {
  const missingVariables = new Set<string>();
  const sources = new Set<string>();
  let hasVariables = false;
  let hasSecrets = false;
  let resolvedValue = input ?? '';
  let displayValue = input ?? '';

  for (let pass = 0; pass < 32; pass += 1) {
    let changed = false;
    const resolvePass = (current: string, masked: boolean) => current.replace(
      VARIABLE_PATTERN,
      (fullMatch: string, groupA: string | undefined, groupB: string | undefined) => {
        const variableName = (groupA ?? groupB ?? '').trim();
        if (!variableName) return fullMatch;

        hasVariables = true;
        const variable = variables.get(variableName.toLowerCase());
        if (!variable) {
          missingVariables.add(variableName);
          return fullMatch;
        }

        changed = true;
        sources.add(variable.source);
        const shouldMask = masked || variable.isSecret === true;
        if (shouldMask) hasSecrets = true;
        return shouldMask ? SECRET_MASK : variable.value ?? '';
      },
    );

    const nextResolvedValue = resolvePass(resolvedValue, false);
    const nextDisplayValue = resolvePass(displayValue, sensitive);
    resolvedValue = nextResolvedValue;
    displayValue = nextDisplayValue;

    if (!changed || (!VARIABLE_PATTERN.test(resolvedValue) && !VARIABLE_PATTERN.test(displayValue))) {
      VARIABLE_PATTERN.lastIndex = 0;
      break;
    }
    VARIABLE_PATTERN.lastIndex = 0;
  }

  const inputHasVariables = VARIABLE_PATTERN.test(input ?? '');
  VARIABLE_PATTERN.lastIndex = 0;
  if (sensitive && !inputHasVariables) {
    hasSecrets = true;
    displayValue = SECRET_MASK;
  }

  return {
    resolvedValue,
    displayValue,
    missingVariables: [...missingVariables],
    sources: [...sources],
    hasVariables: inputHasVariables || hasVariables,
    hasSecrets,
  };
}
