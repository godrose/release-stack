// Builds two tiny git repos (LibA, LibB) and a stack.json for them in a temp dir.
// LibA packs with plain dotnet pack. LibB depends on LibA by PackageReference and packs through its nuspec.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, git, put, tmp } from '../helpers.js';

const XUNIT = `<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.8.1" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.1" />`;

const dotnet = (cwd, ...args) => execFileSync('dotnet', args, { cwd, stdio: 'pipe' });

function lib({ name, body, pin, failing, infra }) {
  const files = {
    [`src/${name}/${name}.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><Version>1.0.0</Version></PropertyGroup>
  ${pin ? `<ItemGroup><PackageReference Include="${pin}" Version="1.0.0" /></ItemGroup>` : ''}
</Project>
`,
    [`src/${name}/Code.cs`]: body,
    [`src/${name}.Tests/${name}.Tests.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsPackable>false</IsPackable></PropertyGroup>
  <ItemGroup>
    ${XUNIT}
    <ProjectReference Include="..\\${name}\\${name}.csproj" />
    ${infra ? `<ProjectReference Include="..\\${name}.TestInfra\\${name}.TestInfra.csproj" />` : ''}
  </ItemGroup>
</Project>
`,
    [`src/${name}.Tests/Tests.cs`]: `using Xunit;
public class Tests { [Fact] public void Works() => Assert.Equal(${failing ? 'false' : 'true'}, ${infra ? `${name}.TestInfra.Helper.Truth()` : 'true'}); }
`,
  };
  if (infra) {
    files[`src/${name}.TestInfra/${name}.TestInfra.csproj`] = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsPackable>false</IsPackable></PropertyGroup>
</Project>
`;
    files[`src/${name}.TestInfra/Helper.cs`] = `namespace ${name}.TestInfra { public static class Helper { public static bool Truth() => true; } }\n`;
  }
  const dir = makeRepo(files);
  dotnet(join(dir, 'src'), 'new', 'sln', '-n', name, '--format', 'sln');
  dotnet(join(dir, 'src'), 'sln', `${name}.sln`, 'add', `${name}/${name}.csproj`, `${name}.Tests/${name}.Tests.csproj`, ...(infra ? [`${name}.TestInfra/${name}.TestInfra.csproj`] : []));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'solution');
  return dir;
}

export function makeStack({ failingB = false } = {}) {
  const a = lib({ name: 'LibA', body: 'namespace LibA { public static class A { public static int One() => 1; } }\n', failing: false, infra: true });
  const b = lib({ name: 'LibB', body: 'namespace LibB { public static class B { public static int Two() => 2; } }\n', pin: 'LibA', failing: failingB });
  put(b, 'devops/pack/LibB/contents/LibB.nuspec', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2011/08/nuspec.xsd">
  <metadata>
    <id>LibB</id>
    <version>1.0.0</version>
    <authors>t</authors>
    <description>t</description>
    <dependencies>
      <dependency id="LibA" version="1.0.0" />
    </dependencies>
  </metadata>
</package>
`);
  git(b, 'add', '-A');
  git(b, 'commit', '-q', '-m', 'nuspec');
  const feed = tmp('rcfeed');
  const manifestPath = join(tmp('manifest'), 'stack.json');
  writeFileSync(manifestPath, JSON.stringify({
    feed,
    repos: [
      { name: 'LibA', path: a, platform: 'any', solution: 'src/LibA.sln', tests: ['src/LibA.Tests/LibA.Tests.csproj'],
        packages: [{ id: 'LibA', project: 'src/LibA/LibA.csproj', pack: 'dotnet' }] },
      { name: 'LibB', path: b, platform: 'any', solution: 'src/LibB.sln', tests: ['src/LibB.Tests/LibB.Tests.csproj'],
        packages: [{ id: 'LibB', project: 'src/LibB/LibB.csproj', pack: 'nuspec', nuspec: 'devops/pack/LibB/contents/LibB.nuspec',
          lib: [{ dir: 'src/LibB/bin/Release/net10.0', tfm: 'net10.0', glob: 'LibB.dll' }] }] },
    ],
  }));
  return { manifestPath, feed, repos: { LibA: a, LibB: b } };
}
