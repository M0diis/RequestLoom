namespace RequestLoom.Api.Services;

public static class RequestUrl
{
    public static string AppendQueryParameter(string url, string key, string value)
    {
        var fragmentIndex = url.IndexOf('#');
        var fragment = fragmentIndex < 0 ? "" : url[fragmentIndex..];
        var target = fragmentIndex < 0 ? url : url[..fragmentIndex];
        var separator = target.EndsWith('?') || target.EndsWith('&') ? "" : target.Contains('?') ? "&" : "?";
        return $"{target}{separator}{Uri.EscapeDataString(key)}={Uri.EscapeDataString(value)}{fragment}";
    }
}
