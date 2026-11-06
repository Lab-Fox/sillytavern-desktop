# Writing helper: asks Windows' spellchecker which words of a list it marks as
# wrong. Only reads: nothing is added or changed here. One word per line in
# -In, the words it rejects in -Out.
param([string]$In, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
[ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellingError { uint StartIndex { get; } uint Length { get; } int CorrectiveAction { get; } [return: MarshalAs(UnmanagedType.LPWStr)] string get_Replacement(); }
[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IEnumSpellingError { [PreserveSig] int Next(out ISpellingError e); }
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellChecker { [return: MarshalAs(UnmanagedType.LPWStr)] string get_LanguageTag(); IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text); }
[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellCheckerFactory { IntPtr get_SupportedLanguages(); int IsSupported([MarshalAs(UnmanagedType.LPWStr)] string tag); ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string tag); }
public static class WritingHelperSpelling {
  public static List<string> Rejected(string[] words) {
    var f = (ISpellCheckerFactory)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")));
    var c = f.CreateSpellChecker("en-US");
    var bad = new List<string>();
    for (int i = 0; i < words.Length; i += 500) {
      var sb = new StringBuilder(); int n = Math.Min(500, words.Length - i);
      for (int k = 0; k < n; k++) { sb.Append(words[i + k]); sb.Append(" . "); }
      string t = sb.ToString(); var e = c.Check(t); ISpellingError x;
      while (e.Next(out x) == 0) { bad.Add(t.Substring((int)x.StartIndex, (int)x.Length)); Marshal.ReleaseComObject(x); }
      Marshal.ReleaseComObject(e);
    }
    return bad;
  }
}
'@
$words = [IO.File]::ReadAllLines($In, [Text.Encoding]::UTF8)
[IO.File]::WriteAllLines($Out, [WritingHelperSpelling]::Rejected($words), (New-Object Text.UTF8Encoding($false)))
