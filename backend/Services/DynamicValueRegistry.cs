using System.Globalization;
using System.Text;
using System.Text.Json;
using Bogus;

namespace RequestLoom.Api.Services;

public sealed class DynamicValueDefinition
{
    public string Name { get; init; } = "";
    public string Signature { get; init; } = "";
    public string[] Aliases { get; init; } = [];
    public string Category { get; init; } = "";
    public string Description { get; init; } = "";
    public string Example { get; init; } = "";
    public string OutputType { get; init; } = "string";
}

public static class DynamicValueRegistry
{
    private static readonly DynamicValueDefinition[] Items =
    [
        new() { Name = "$uuid", Signature = "{{$uuid}}", Aliases = ["$guid", "$randomUUID"], Category = "Identity and time", Description = "A random UUID.", Example = "{{$uuid}}", OutputType = "string" },
        new() { Name = "$timestamp", Signature = "{{$timestamp}}", Category = "Identity and time", Description = "The current Unix timestamp in seconds.", Example = "{{$timestamp}}", OutputType = "integer" },
        new() { Name = "$isoTimestamp", Signature = "{{$isoTimestamp}}", Category = "Identity and time", Description = "The current UTC timestamp in ISO 8601 format.", Example = "{{$isoTimestamp}}", OutputType = "string" },
        new() { Name = "$date", Signature = "{{$date(\"2026-01-01\",\"2026-12-31\")}}", Category = "Identity and time", Description = "A random date between two ISO dates.", Example = "{{$date(\"2026-01-01\",\"2026-12-31\")}}", OutputType = "string" },
        new() { Name = "$integer", Signature = "{{$integer(1,100)}}", Aliases = ["$randomInt"], Category = "Scalars", Description = "A random integer. Defaults to 0–1000.", Example = "{{$integer(1,100)}}", OutputType = "integer" },
        new() { Name = "$decimal", Signature = "{{$decimal(0,100,2)}}", Category = "Scalars", Description = "A random decimal. Defaults to 0–1000 with two decimal places.", Example = "{{$decimal(0,100,2)}}", OutputType = "decimal" },
        new() { Name = "$boolean", Signature = "{{$boolean}}", Aliases = ["$randomBoolean"], Category = "Scalars", Description = "A random boolean.", Example = "{{$boolean}}", OutputType = "boolean" },
        new() { Name = "$string", Signature = "{{$string(12)}}", Category = "Strings", Description = "A random alphabetic string. Defaults to 12 characters.", Example = "{{$string(12)}}", OutputType = "string" },
        new() { Name = "$alphanumeric", Signature = "{{$alphanumeric(16)}}", Aliases = ["$randomAlphaNumeric"], Category = "Strings", Description = "A random alphanumeric string. Defaults to one character.", Example = "{{$alphanumeric(16)}}", OutputType = "string" },
        new() { Name = "$pick", Signature = "{{$pick([\"new\",\"active\",\"closed\"])}}", Category = "Strings", Description = "Selects one string from a JSON array.", Example = "{{$pick([\"new\",\"active\",\"closed\"])}}", OutputType = "string" },
        new() { Name = "$firstName", Signature = "{{$firstName}}", Aliases = ["$randomFirstName"], Category = "People and contact", Description = "A random first name.", Example = "{{$firstName}}", OutputType = "string" },
        new() { Name = "$lastName", Signature = "{{$lastName}}", Aliases = ["$randomLastName"], Category = "People and contact", Description = "A random last name.", Example = "{{$lastName}}", OutputType = "string" },
        new() { Name = "$fullName", Signature = "{{$fullName}}", Aliases = ["$randomFullName"], Category = "People and contact", Description = "A random full name.", Example = "{{$fullName}}", OutputType = "string" },
        new() { Name = "$email", Signature = "{{$email}}", Aliases = ["$randomEmail"], Category = "People and contact", Description = "A random email address.", Example = "{{$email}}", OutputType = "string" },
        new() { Name = "$username", Signature = "{{$username}}", Aliases = ["$randomUserName"], Category = "People and contact", Description = "A random username.", Example = "{{$username}}", OutputType = "string" },
        new() { Name = "$phone", Signature = "{{$phone}}", Aliases = ["$randomPhoneNumber"], Category = "People and contact", Description = "A random phone number.", Example = "{{$phone}}", OutputType = "string" },
        new() { Name = "$streetAddress", Signature = "{{$streetAddress}}", Aliases = ["$randomStreetAddress"], Category = "Location and text", Description = "A random street address.", Example = "{{$streetAddress}}", OutputType = "string" },
        new() { Name = "$city", Signature = "{{$city}}", Aliases = ["$randomCity"], Category = "Location and text", Description = "A random city.", Example = "{{$city}}", OutputType = "string" },
        new() { Name = "$country", Signature = "{{$country}}", Aliases = ["$randomCountry"], Category = "Location and text", Description = "A random country.", Example = "{{$country}}", OutputType = "string" },
        new() { Name = "$word", Signature = "{{$word}}", Aliases = ["$randomWord"], Category = "Location and text", Description = "A random word.", Example = "{{$word}}", OutputType = "string" },
        new() { Name = "$words", Signature = "{{$words(3)}}", Aliases = ["$randomWords"], Category = "Location and text", Description = "A random group of words. Defaults to three words.", Example = "{{$words(3)}}", OutputType = "string" },
        new() { Name = "$sentence", Signature = "{{$sentence(8)}}", Aliases = ["$randomPhrase"], Category = "Location and text", Description = "A random sentence. Defaults to eight words.", Example = "{{$sentence(8)}}", OutputType = "string" },
        new() { Name = "$paragraph", Signature = "{{$paragraph(3)}}", Category = "Location and text", Description = "A random paragraph. Defaults to three sentences.", Example = "{{$paragraph(3)}}", OutputType = "string" },
    ];

    private static readonly Dictionary<string, string> NameMap = Items
        .SelectMany(item => new[] { item.Name }.Concat(item.Aliases).Select(name => (name, item.Name)))
        .ToDictionary(pair => pair.name, pair => pair.Name, StringComparer.OrdinalIgnoreCase);

    private static readonly Dictionary<string, DynamicValueDefinition> DefinitionMap =
        Items.ToDictionary(item => item.Name, StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<DynamicValueDefinition> GetDefinitions() => Items;

    internal static bool TryGetCanonicalName(string name, out string canonicalName)
    {
        return NameMap.TryGetValue(name, out canonicalName!);
    }

    internal static bool TryGetDefinition(string name, out DynamicValueDefinition definition)
    {
        return DefinitionMap.TryGetValue(name, out definition!);
    }
}

public sealed class TemplateResolutionSession
{
    private const char EscapedTokenStart = '\uE000';
    private const char EscapedTokenEnd = '\uE001';

    private static readonly System.Text.RegularExpressions.Regex VariablePattern =
        new(@"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", System.Text.RegularExpressions.RegexOptions.Compiled);

    private readonly Dictionary<string, string> _rawVariables;
    private readonly Dictionary<string, string> _variables;
    private readonly Dictionary<string, string> _generatedVariableCache = new(StringComparer.Ordinal);

    public TemplateResolutionSession(
        IReadOnlyDictionary<string, string>? variables = null,
        DateTimeOffset? now = null)
    {
        _rawVariables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        _variables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (variables != null)
        {
            foreach (var (key, value) in variables)
            {
                if (!string.IsNullOrWhiteSpace(key))
                {
                    _rawVariables[key.Trim()] = value ?? "";
                    _variables[key.Trim()] = value ?? "";
                }
            }
        }

        CurrentTime = now ?? DateTimeOffset.UtcNow;
        Faker = new Faker("en");
        MaterializeVariables();
    }

    public DateTimeOffset CurrentTime { get; }
    internal Faker Faker { get; }

    public IReadOnlyDictionary<string, string> Variables => _variables.ToDictionary(
        pair => pair.Key,
        pair => GetVariable(pair.Key) ?? "",
        StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, string> ToDictionary() => Variables.ToDictionary(
        pair => pair.Key,
        pair => pair.Value,
        StringComparer.OrdinalIgnoreCase);

    public string? GetVariable(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        return _variables.ContainsKey(key.Trim())
            ? RestoreEscapedTokens(ResolveMaterializedValue(_variables[key.Trim()]))
            : null;
    }

    public void SetVariable(string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(key)) return;

        var normalizedKey = key.Trim();
        _rawVariables[normalizedKey] = value ?? "";
        ClearGeneratedCache(normalizedKey);
        _variables[normalizedKey] = MaterializeVariable(normalizedKey, value ?? "");
    }

    public void UnsetVariable(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return;

        var normalizedKey = key.Trim();
        _rawVariables.Remove(normalizedKey);
        _variables.Remove(normalizedKey);
        ClearGeneratedCache(normalizedKey);
    }

    public string Resolve(string? input)
    {
        if (string.IsNullOrEmpty(input)) return input ?? "";

        var withVariables = ResolveMaterializedValue(input);
        return RestoreEscapedTokens(ExpandDynamicTokens(withVariables, owner: null));
    }

    internal string ResolveOrdinary(string? input)
    {
        if (string.IsNullOrEmpty(input)) return input ?? "";

        return VariablePattern.Replace(input, match =>
            _rawVariables.TryGetValue(match.Groups[1].Value, out var value) ? value : match.Value);
    }

    private void MaterializeVariables()
    {
        // First generate tokens owned by variables. This lets a variable such as
        // "{{$uuid}}" remain stable when it is referenced more than once.
        foreach (var (key, value) in _rawVariables.ToArray())
        {
            _variables[key] = ExpandDynamicTokens(value, VariableOwner(key));
        }

    }

    private string MaterializeVariable(string key, string value)
    {
        return ExpandDynamicTokens(value, VariableOwner(key));
    }

    private string InterpolateVariables(string input)
    {
        return VariablePattern.Replace(input, match =>
        {
            var key = match.Groups[1].Value;
            return _variables.TryGetValue(key, out var value) ? value : match.Value;
        });
    }

    private string ResolveMaterializedValue(string input)
    {
        var current = input;
        for (var pass = 0; pass < 32; pass++)
        {
            var next = InterpolateVariables(current);
            if (next == current) break;
            current = next;
        }

        return current;
    }

    private string ExpandDynamicTokens(string input, string? owner)
    {
        if (string.IsNullOrEmpty(input)) return input;

        var output = new StringBuilder(input.Length);
        var occurrence = 0;

        for (var index = 0; index < input.Length;)
        {
            if (input[index] == EscapedTokenStart)
            {
                var markerEnd = input.IndexOf(EscapedTokenEnd, index + 1);
                if (markerEnd >= 0)
                {
                    output.Append(input, index, markerEnd - index + 1);
                    index = markerEnd + 1;
                    continue;
                }
            }

            if (index + 1 >= input.Length || input[index] != '{' || input[index + 1] != '{')
            {
                output.Append(input[index++]);
                continue;
            }

            var end = FindTokenEnd(input, index + 2);
            if (end < 0)
            {
                output.Append(input, index, input.Length - index);
                break;
            }

            var token = input[index..(end + 2)];
            var escaped = index > 0 && input[index - 1] == '\\';
            if (escaped && output.Length > 0 && output[^1] == '\\')
            {
                output.Length--;
            }

            if (escaped)
            {
                output.Append(EscapedTokenStart).Append(token).Append(EscapedTokenEnd);
            }
            else if (token.StartsWith("{{$", StringComparison.Ordinal) &&
                     DynamicValueGenerator.TryGenerate(token, this, out var generated))
            {
                var cacheKey = owner == null ? null : $"{owner}\0{occurrence}";
                if (cacheKey != null && _generatedVariableCache.TryGetValue(cacheKey, out var cached))
                {
                    output.Append(cached);
                }
                else
                {
                    output.Append(generated);
                    if (cacheKey != null)
                    {
                        _generatedVariableCache[cacheKey] = generated;
                    }
                }

                occurrence++;
            }
            else
            {
                output.Append(token);
            }

            index = end + 2;
        }

        return output.ToString();
    }

    private static int FindTokenEnd(string input, int start)
    {
        var inString = false;
        var escaped = false;

        for (var index = start; index < input.Length - 1; index++)
        {
            var current = input[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                }
                else if (current == '\\')
                {
                    escaped = true;
                }
                else if (current == '"')
                {
                    inString = false;
                }

                continue;
            }

            if (current == '"')
            {
                inString = true;
            }
            else if (current == '}' && input[index + 1] == '}')
            {
                return index;
            }
        }

        return -1;
    }

    private void ClearGeneratedCache(string key)
    {
        var prefix = VariableOwner(key) + '\0';
        foreach (var cacheKey in _generatedVariableCache.Keys.Where(cacheKey => cacheKey.StartsWith(prefix, StringComparison.Ordinal)).ToArray())
        {
            _generatedVariableCache.Remove(cacheKey);
        }
    }

    private static string VariableOwner(string key) => $"variable:{key.ToLowerInvariant()}";

    private static string RestoreEscapedTokens(string input)
    {
        if (input.IndexOf(EscapedTokenStart) < 0) return input;
        return input.Replace(EscapedTokenStart.ToString(), "", StringComparison.Ordinal)
            .Replace(EscapedTokenEnd.ToString(), "", StringComparison.Ordinal);
    }
}

internal static class DynamicValueGenerator
{
    public static bool TryGenerate(string token, TemplateResolutionSession session, out string value)
    {
        value = token;
        if (!TryParse(token, out var name, out var arguments)) return false;
        if (!DynamicValueRegistry.TryGetCanonicalName(name, out var canonicalName)) return false;

        var faker = session.Faker;
        var now = session.CurrentTime;

        switch (canonicalName.ToLowerInvariant())
        {
            case "$uuid":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Random.Guid().ToString();
                return true;
            case "$timestamp":
                if (!HasArguments(arguments, 0)) return false;
                value = now.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
                return true;
            case "$isotimestamp":
                if (!HasArguments(arguments, 0)) return false;
                value = now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
                return true;
            case "$date":
                return TryDate(arguments, faker, out value);
            case "$integer":
                return TryInteger(arguments, faker, out value);
            case "$decimal":
                return TryDecimal(arguments, faker, out value);
            case "$boolean":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Random.Bool() ? "true" : "false";
                return true;
            case "$string":
                if (!TryLength(arguments, 12, out var stringLength)) return false;
                value = faker.Random.String2(stringLength);
                return true;
            case "$alphanumeric":
                if (!TryLength(arguments, 1, out var alphaNumericLength)) return false;
                value = faker.Random.AlphaNumeric(alphaNumericLength);
                return true;
            case "$pick":
                return TryPick(arguments, faker, out value);
            case "$firstname":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Name.FirstName();
                return true;
            case "$lastname":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Name.LastName();
                return true;
            case "$fullname":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Name.FullName();
                return true;
            case "$email":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Internet.Email();
                return true;
            case "$username":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Internet.UserName();
                return true;
            case "$phone":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Phone.PhoneNumber();
                return true;
            case "$streetaddress":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Address.StreetAddress();
                return true;
            case "$city":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Address.City();
                return true;
            case "$country":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Address.Country();
                return true;
            case "$word":
                if (!HasArguments(arguments, 0)) return false;
                value = faker.Random.Word();
                return true;
            case "$words":
                if (!TryCount(arguments, 3, out var wordCount)) return false;
                value = string.Join(" ", faker.Lorem.Words(wordCount));
                return true;
            case "$sentence":
                if (!TryCount(arguments, 8, out var sentenceWords)) return false;
                value = faker.Lorem.Sentence(sentenceWords);
                return true;
            case "$paragraph":
                if (!TryCount(arguments, 3, out var sentenceCount)) return false;
                value = faker.Lorem.Paragraph(sentenceCount);
                return true;
            default:
                return false;
        }
    }

    private static bool TryParse(string token, out string name, out List<JsonElement> arguments)
    {
        name = "";
        arguments = [];

        if (!token.StartsWith("{{", StringComparison.Ordinal) || !token.EndsWith("}}", StringComparison.Ordinal))
            return false;

        var inner = token[2..^2].Trim();
        if (!inner.StartsWith('$')) return false;

        var openParen = inner.IndexOf('(');
        if (openParen < 0)
        {
            name = inner;
            return true;
        }

        if (!inner.EndsWith(')') || openParen <= 1)
            return false;

        name = inner[..openParen].Trim();
        var argumentText = inner[(openParen + 1)..^1];
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentText) ? "[]" : $"[{argumentText}]");
            if (document.RootElement.ValueKind != JsonValueKind.Array) return false;
            arguments = document.RootElement.EnumerateArray().Select(argument => argument.Clone()).ToList();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool HasArguments(IReadOnlyCollection<JsonElement> arguments, int count) => arguments.Count == count;

    private static bool TryLength(IReadOnlyList<JsonElement> arguments, int defaultValue, out int length)
    {
        length = defaultValue;
        if (arguments.Count == 0) return true;
        if (arguments.Count != 1 || !arguments[0].TryGetInt32(out length) || length < 0 || length > 10000)
            return false;
        return true;
    }

    private static bool TryCount(IReadOnlyList<JsonElement> arguments, int defaultValue, out int count)
    {
        if (!TryLength(arguments, defaultValue, out count)) return false;
        return count > 0;
    }

    private static bool TryInteger(IReadOnlyList<JsonElement> arguments, Faker faker, out string value)
    {
        value = "";
        if (arguments.Count > 2) return false;
        var min = 0;
        var max = 1000;
        if (arguments.Count >= 1 && (!arguments[0].TryGetInt32(out min))) return false;
        if (arguments.Count == 2 && !arguments[1].TryGetInt32(out max)) return false;
        if (min > max) return false;
        value = faker.Random.Int(min, max).ToString(CultureInfo.InvariantCulture);
        return true;
    }

    private static bool TryDecimal(IReadOnlyList<JsonElement> arguments, Faker faker, out string value)
    {
        value = "";
        if (arguments.Count > 3) return false;
        decimal min = 0;
        decimal max = 1000;
        var decimals = 2;
        if (arguments.Count >= 1 && !arguments[0].TryGetDecimal(out min)) return false;
        if (arguments.Count >= 2 && !arguments[1].TryGetDecimal(out max)) return false;
        if (arguments.Count == 3 && (!arguments[2].TryGetInt32(out decimals) || decimals < 0 || decimals > 10)) return false;
        if (min > max) return false;

        var generated = faker.Random.Decimal(min, max);
        value = Math.Round(generated, decimals, MidpointRounding.AwayFromZero)
            .ToString($"F{decimals}", CultureInfo.InvariantCulture);
        return true;
    }

    private static bool TryDate(IReadOnlyList<JsonElement> arguments, Faker faker, out string value)
    {
        value = "";
        if (arguments.Count != 2 || arguments.Any(argument => argument.ValueKind != JsonValueKind.String)) return false;
        if (!DateTimeOffset.TryParse(arguments[0].GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var start) ||
            !DateTimeOffset.TryParse(arguments[1].GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var end) ||
            start > end)
        {
            return false;
        }

        value = faker.Date.Between(start.UtcDateTime, end.UtcDateTime).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return true;
    }

    private static bool TryPick(IReadOnlyList<JsonElement> arguments, Faker faker, out string value)
    {
        value = "";
        if (arguments.Count != 1 || arguments[0].ValueKind != JsonValueKind.Array) return false;
        var choices = arguments[0].EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString() ?? "")
            .ToArray();
        if (choices.Length == 0 || choices.Length != arguments[0].GetArrayLength()) return false;
        value = faker.Random.ArrayElement(choices);
        return true;
    }
}
