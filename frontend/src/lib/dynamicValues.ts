import type { DynamicValueDefinition } from '../types';

export const DEFAULT_DYNAMIC_VALUE_SUGGESTIONS = [
  '{{$uuid}}', '{{$guid}}', '{{$randomUUID}}', '{{$timestamp}}', '{{$isoTimestamp}}',
  '{{$date("2026-01-01","2026-12-31")}}',
  '{{$integer(1,100)}}', '{{$randomInt(1,100)}}', '{{$decimal(0,100,2)}}',
  '{{$boolean}}', '{{$randomBoolean}}', '{{$string(12)}}',
  '{{$alphanumeric(16)}}', '{{$randomAlphaNumeric(16)}}',
  '{{$pick(["new","active","closed"])}}',
  '{{$firstName}}', '{{$randomFirstName}}', '{{$lastName}}', '{{$randomLastName}}',
  '{{$fullName}}', '{{$randomFullName}}', '{{$email}}', '{{$randomEmail}}',
  '{{$username}}', '{{$randomUserName}}', '{{$phone}}', '{{$randomPhoneNumber}}',
  '{{$streetAddress}}', '{{$randomStreetAddress}}', '{{$city}}', '{{$randomCity}}',
  '{{$country}}', '{{$randomCountry}}', '{{$word}}', '{{$randomWord}}',
  '{{$words(3)}}', '{{$randomWords(3)}}', '{{$sentence(8)}}', '{{$randomPhrase(8)}}',
  '{{$paragraph(3)}}',
];

export function getDynamicValueSuggestions(definitions: DynamicValueDefinition[]): string[] {
  if (definitions.length === 0) return DEFAULT_DYNAMIC_VALUE_SUGGESTIONS;

  const suggestions = new Set<string>();
  for (const definition of definitions) {
    suggestions.add(definition.signature);
    for (const alias of definition.aliases ?? []) {
      suggestions.add(`{{${alias}}}`);
    }
  }
  return [...suggestions];
}
