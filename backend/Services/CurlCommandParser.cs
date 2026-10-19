using System.Text;
using System.Text.Json;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

internal static class CurlCommandParser
{
    public static CurlParseResult Parse(string command)
    {
        var tokens = Tokenize(command);
        var result = new CurlParseResult();
        var bodies = new List<string>();
        var explicitMethod = false;
        for (var i = tokens.Count > 0 && tokens[0].Equals("curl", StringComparison.OrdinalIgnoreCase) ? 1 : 0; i < tokens.Count; i++)
        {
            var token = tokens[i];
            var option = token;
            string? inline = null;
            if (token.StartsWith("--") && token.Contains('='))
            {
                var equals = token.IndexOf('=');
                option = token[..equals]; inline = token[(equals + 1)..];
            }
            else if (token.Length > 2 && token[0] == '-' && "XHdu".Contains(token[1]))
            {
                option = token[..2]; inline = token[2..];
            }
            string Value()
            {
                if (inline != null) return inline;
                if (++i >= tokens.Count) throw new ArgumentException($"Missing value for {option}.");
                return tokens[i];
            }
            switch (option)
            {
                case "-X": case "--request": result.Method = Value().ToUpperInvariant(); explicitMethod = true; break;
                case "--url": result.Url = Value(); break;
                case "-H": case "--header":
                    var header = Value();
                    var colon = header.IndexOf(':');
                    if (colon <= 0) throw new ArgumentException("Headers must use 'Name: value'.");
                    result.Headers.Add(new KeyValuePairRequest { Key = header[..colon].Trim(), Value = header[(colon + 1)..].TrimStart() });
                    break;
                case "-d": case "--data": case "--data-raw": case "--data-binary": case "--json":
                    var body = Value();
                    if (option != "--data-raw" && body.StartsWith('@'))
                        throw new ArgumentException("File-based cURL bodies must be uploaded in the request editor.");
                    bodies.Add(body);
                    if (option == "--json") result.Headers.Add(new KeyValuePairRequest { Key = "Content-Type", Value = "application/json" });
                    break;
                case "-u": case "--user":
                    var credentials = Value();
                    var split = credentials.IndexOf(':');
                    result.Auth = new AuthRequest { AuthType = "basic", ConfigJson = JsonSerializer.Serialize(new
                    {
                        username = split < 0 ? credentials : credentials[..split], password = split < 0 ? "" : credentials[(split + 1)..],
                    }) };
                    break;
                case "-I": case "--head": result.Method = "HEAD"; explicitMethod = true; break;
                case "-L": case "--location": case "-s": case "--silent": case "-S": case "--show-error":
                case "-k": case "--insecure": case "--compressed": case "-v": case "--verbose": case "-i": case "--include": case "--globoff": case "-g":
                    break;
                default:
                    if (option.StartsWith('-')) throw new ArgumentException($"Unsupported cURL option: {option}");
                    if (result.Url.Length > 0) throw new ArgumentException("Import one cURL URL at a time.");
                    result.Url = token;
                    break;
            }
        }
        if (string.IsNullOrWhiteSpace(result.Url)) throw new ArgumentException("The cURL command must include a URL.");
        if (bodies.Count > 0)
        {
            result.Body = string.Join("&", bodies);
            if (!explicitMethod) result.Method = "POST";
            var type = result.Headers.LastOrDefault(h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value ?? "";
            result.BodyType = type.Contains("json", StringComparison.OrdinalIgnoreCase) ? "json"
                : type.Contains("xml", StringComparison.OrdinalIgnoreCase) ? "xml"
                : type.Contains("x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase) ? "form"
                : IsJson(result.Body) ? "json" : "text";
        }
        var bearer = result.Auth == null
            ? result.Headers.LastOrDefault(h => h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase) &&
                h.Value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            : null;
        if (bearer != null)
        {
            // Represent the token once, as auth, rather than also sending the copied header.
            result.Auth = new AuthRequest { AuthType = "bearer", ConfigJson = JsonSerializer.Serialize(new { token = bearer.Value[7..].Trim() }) };
            result.Headers.RemoveAll(h => h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase));
        }
        if (Uri.TryCreate(result.Url, UriKind.Absolute, out var uri))
            result.ServiceName = uri.AbsolutePath.Trim('/').Split('/')[0];
        return result;
    }

    private static bool IsJson(string value)
    {
        try { using var document = JsonDocument.Parse(value); return true; }
        catch (JsonException) { return false; }
    }

    private static List<string> Tokenize(string command)
    {
        var tokens = new List<string>();
        var current = new StringBuilder();
        var quote = '\0';
        var started = false;
        for (var i = 0; i < command.Length; i++)
        {
            var c = command[i];
            if (c == '\\' && quote != '\'' && i + 1 < command.Length)
            {
                var next = command[i + 1];
                if (next is '\n' or '\r')
                {
                    i++;
                    if (next == '\r' && i + 1 < command.Length && command[i + 1] == '\n') i++;
                    continue;
                }
                if (quote == '\0' || next is '"' or '\\' or '$' or '`') { current.Append(next); i++; started = true; continue; }
            }
            if (quote != '\0')
            {
                if (c == quote) quote = '\0'; else current.Append(c);
            }
            else if (c is '\'' or '"') { quote = c; started = true; }
            else if (char.IsWhiteSpace(c))
            {
                if (started) { tokens.Add(current.ToString()); current.Clear(); started = false; }
            }
            else { current.Append(c); started = true; }
        }
        if (quote != '\0') throw new ArgumentException("The cURL command has an unterminated quote.");
        if (started) tokens.Add(current.ToString());
        return tokens;
    }
}
