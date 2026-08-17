using System;
using Jint;
using Jint.Native;
using Jint.Runtime;
using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

/// <summary>
/// Shared test script runner used by both single requests and collection runs.
/// </summary>
public static class TestScriptRunner
{
    public static List<TestResult> Run(string testScript, ExecuteResponse response, Dictionary<string, string>? variables = null)
    {
        var results = new List<TestResult>();

        if (string.IsNullOrWhiteSpace(testScript))
            return results;

        try
        {
            var engine = new Engine(options => options.TimeoutInterval(TimeSpan.FromSeconds(5)));

            // Define expect() as a plain JS function that returns assertion methods
            engine.Execute(@"
                function expect(actual) {
                    return {
                        _actual: actual,
                        toBe: function(expected) {
                            var a = actual == null ? '' : String(actual);
                            var e = expected == null ? '' : String(expected);
                            if (a !== e) throw new Error('Expected ' + JSON.stringify(e) + ' but got ' + JSON.stringify(a));
                        },
                        toEqual: function(expected) {
                            var a = actual == null ? '' : String(actual);
                            var e = expected == null ? '' : String(expected);
                            if (a !== e) throw new Error('Expected ' + JSON.stringify(e) + ' but got ' + JSON.stringify(a));
                        },
                        toContain: function(substring) {
                            var a = actual == null ? '' : String(actual);
                            var s = substring == null ? '' : String(substring);
                            if (a.indexOf(s) === -1) throw new Error('Expected string to contain ' + JSON.stringify(s));
                        },
                        toBeGreaterThan: function(value) {
                            var a = Number(actual);
                            var v = Number(value);
                            if (!(a > v)) throw new Error('Expected ' + a + ' to be greater than ' + v);
                        },
                        toBeLessThan: function(value) {
                            var a = Number(actual);
                            var v = Number(value);
                            if (!(a < v)) throw new Error('Expected ' + a + ' to be less than ' + v);
                        },
                        not: {
                            toBe: function(expected) {
                                var a = actual == null ? '' : String(actual);
                                var e = expected == null ? '' : String(expected);
                                if (a === e) throw new Error('Expected ' + JSON.stringify(a) + ' not to be ' + JSON.stringify(e));
                            },
                            toEqual: function(expected) {
                                var a = actual == null ? '' : String(actual);
                                var e = expected == null ? '' : String(expected);
                                if (a === e) throw new Error('Expected ' + JSON.stringify(a) + ' not to equal ' + JSON.stringify(e));
                            }
                        }
                    };
                }
            ");

            // Register test(name, fn) - uses JsValue and tries to invoke
            engine.SetValue("test", new Action<string, JsValue>((name, fn) =>
            {
                try
                {
                    engine.Invoke(fn);
                    results.Add(new TestResult { Name = name, Passed = true });
                }
                catch (Exception ex)
                {
                    var msg = ex.InnerException?.Message ?? ex.Message;
                    results.Add(new TestResult { Name = name, Passed = false, Message = msg ?? "Test assertion failed" });
                }
            }));

            // Expose response
            engine.SetValue("response", new
            {
                status = response.StatusCode,
                statusText = response.StatusText,
                body = response.Body ?? "",
                contentType = response.ContentType ?? "",
                headers = response.Headers.ToDictionary(
                    h => h.Key, h => (object)string.Join(", ", h.Value)),
                time = response.ResponseTimeMs,
                size = response.ResponseSizeBytes,
            });

            // Expose variables
            if (variables != null)
            {
                var vars = new Dictionary<string, object?>();
                foreach (var (k, v) in variables)
                    vars[k] = v;
                engine.SetValue("vars", vars);
            }

            engine.Execute(testScript);
        }
        catch (Exception ex)
        {
            results.Add(new TestResult { Name = "Script Error", Passed = false, Message = ex.Message });
        }

        return results;
    }
}
