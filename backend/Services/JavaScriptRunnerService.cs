using Jint;
using Jint.Native;
using Jint.Runtime;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Runs standalone collection JavaScript files with a small, safe RequestLoom runtime.
/// The runner is intentionally separate from request scripts: it can be used to verify
/// reusable helpers before importing them into a request script.
/// </summary>
public sealed class JavaScriptRunnerService
{
    public JavaScriptRunResponse Run(string code)
    {
        var logs = new List<string>();

        if (string.IsNullOrWhiteSpace(code))
        {
            return new JavaScriptRunResponse { Success = true, Logs = logs };
        }

        try
        {
            var engine = new Engine(options =>
            {
                options.TimeoutInterval(TimeSpan.FromSeconds(5));
                options.LimitRecursion(64);
            });

            engine.SetValue("__requestLoomLog", new Action<JsValue>(value =>
                logs.Add(FormatValue(engine, value))));
            engine.SetValue("__requestLoomWarn", new Action<JsValue>(value =>
                logs.Add($"[warn] {FormatValue(engine, value)}")));
            engine.SetValue("__requestLoomError", new Action<JsValue>(value =>
                logs.Add($"[error] {FormatValue(engine, value)}")));

            engine.Execute(@"
                function __formatConsoleArguments(args) {
                    var values = [];
                    for (var i = 0; i < args.length; i++) {
                        var value = args[i];
                        if (value !== null && typeof value === 'object') {
                            try {
                                values.push(JSON.stringify(value));
                                continue;
                            } catch (ignore) { }
                        }
                        values.push(String(value));
                    }
                    return values.join(' ');
                }
                var console = {
                    log: function() { __requestLoomLog(__formatConsoleArguments(arguments)); },
                    info: function() { __requestLoomLog(__formatConsoleArguments(arguments)); },
                    warn: function() { __requestLoomWarn(__formatConsoleArguments(arguments)); },
                    error: function() { __requestLoomError(__formatConsoleArguments(arguments)); }
                };
                function print() { __requestLoomLog(__formatConsoleArguments(arguments)); }
                var module = { exports: {} };
                var exports = module.exports;
                var vars = {};
                function setVar(key, value) { vars[String(key)] = value; }
                function getVar(key) { return vars[String(key)]; }
            ");

            var result = engine.Evaluate(code);
            var resultText = result.IsUndefined() || result.IsNull()
                ? null
                : FormatValue(engine, result);

            return new JavaScriptRunResponse
            {
                Success = true,
                Logs = logs,
                Result = resultText,
            };
        }
        catch (JavaScriptException ex)
        {
            return new JavaScriptRunResponse
            {
                Success = false,
                Logs = logs,
                Error = ex.Message,
            };
        }
        catch (Exception ex)
        {
            return new JavaScriptRunResponse
            {
                Success = false,
                Logs = logs,
                Error = ex.Message,
            };
        }
    }

    private static string FormatValue(Engine engine, JsValue value)
    {
        if (value.Type == Types.String)
        {
            return value.AsString();
        }

        try
        {
            var stringify = engine.GetValue("JSON").AsObject().Get("stringify");
            var serialized = engine.Invoke(stringify, value);
            if (serialized.Type == Types.String)
            {
                return serialized.AsString();
            }
        }
        catch
        {
            // Fall back to Jint's display value for circular/unserializable objects.
        }

        return value.ToString();
    }
}
