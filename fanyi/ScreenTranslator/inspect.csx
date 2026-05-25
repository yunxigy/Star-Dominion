using System;
using System.Reflection;
var dll = Assembly.LoadFrom(args[0]);
foreach (var t in dll.GetExportedTypes())
{
    Console.WriteLine($"TYPE: {t.FullName}");
    foreach (var c in t.GetConstructors())
        Console.WriteLine($"  CTOR: {c}");
    foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        Console.WriteLine($"  METHOD: {m.Name}({string.Join(", ", m.GetParameters().Select(p => p.ParameterType.Name + " " + p.Name))})");
    foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        Console.WriteLine($"  PROP: {p.PropertyType.Name} {p.Name}");
}
