#!/usr/bin/env bash
# Throwaway spike: how does NuGet order -rc.<yyyymmddHHMM> against -rc1 and the stable version?
set -uo pipefail
export DOTNET_ROOT=~/.dotnet-arm64 PATH=~/.dotnet-arm64:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
T=$(mktemp -d); F=$T/feed; mkdir -p $F
V1=2.3.7-rc.202611111530; V2=2.3.7-rc.202611121000; V3=2.3.7-rc1; V4=2.3.7

mklib() { # name, dir, extra csproj items
  mkdir -p $2; cat > $2/$1.csproj <<XML
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>$3</Project>
XML
  echo "namespace $1 { public class C {} }" > $2/C.cs
}
mklib Probe.Pkg $T/pkg ""
for v in $V1 $V2 $V3 $V4; do dotnet pack $T/pkg/Probe.Pkg.csproj -p:Version=$v -o $F -v q 2>&1 | grep -E "error" ; done
ls $F

consumer() { # label, items
  local d=$T/c-$1; mklib Consumer $d "$2"
  echo "== $1"
  dotnet restore $d/Consumer.csproj --source $F -v q --force 2>&1 | grep -E "error|warn|NU1" | sed 's/^.*\(NU[0-9]*\)/\1/' | cut -c1-200
  grep -o '"Probe.Pkg/[^"]*"' $d/obj/project.assets.json | sort -u | head -3
}
consumer floating '<ItemGroup><PackageReference Include="Probe.Pkg" Version="2.3.7-rc.*"/></ItemGroup>'
consumer exact-rc1ts '<ItemGroup><PackageReference Include="Probe.Pkg" Version="'$V1'"/></ItemGroup>'
consumer exact-rc2ts '<ItemGroup><PackageReference Include="Probe.Pkg" Version="'$V2'"/></ItemGroup>'
consumer exact-rc1 '<ItemGroup><PackageReference Include="Probe.Pkg" Version="'$V3'"/></ItemGroup>'
# a second package that requires Probe.Pkg >= V1, consumed together with a pin on V2
mklib Probe.Dep $T/dep '<ItemGroup><PackageReference Include="Probe.Pkg" Version="['$V1',)"/></ItemGroup>'
dotnet pack $T/dep/Probe.Dep.csproj -p:Version=1.0.0 -o $F -v q --source $F 2>&1 | grep error
consumer dep-needs-ts1-pin-ts2 '<ItemGroup><PackageReference Include="Probe.Dep" Version="1.0.0"/><PackageReference Include="Probe.Pkg" Version="'$V2'"/></ItemGroup>'
# the pitfall: dep needs old-style rc1, consumer pins a timestamp rc
mklib Probe.Dep2 $T/dep2 '<ItemGroup><PackageReference Include="Probe.Pkg" Version="['$V3',)"/></ItemGroup>'
dotnet pack $T/dep2/Probe.Dep2.csproj -p:Version=1.0.0 -o $F -v q --source $F 2>&1 | grep error
consumer dep-needs-rc1-pin-ts2 '<ItemGroup><PackageReference Include="Probe.Dep2" Version="1.0.0"/><PackageReference Include="Probe.Pkg" Version="'$V2'"/></ItemGroup>'
# floating without the stable version in the feed (the real rc feed never holds the stable one)
mv $F/Probe.Pkg.$V4.nupkg $T/stable.nupkg
consumer floating-no-stable '<ItemGroup><PackageReference Include="Probe.Pkg" Version="2.3.7-rc.*"/></ItemGroup>'
# reverse downgrade: dep needs the newer timestamp, consumer pins the older one -> must warn
mklib Probe.Dep3 $T/dep3 '<ItemGroup><PackageReference Include="Probe.Pkg" Version="['$V2',)"/></ItemGroup>'
dotnet pack $T/dep3/Probe.Dep3.csproj -p:Version=1.0.0 -o $F -v q --source $F 2>&1 | grep error
consumer dep-needs-ts2-pin-ts1 '<ItemGroup><PackageReference Include="Probe.Dep3" Version="1.0.0"/><PackageReference Include="Probe.Pkg" Version="'$V1'"/></ItemGroup>'
rm -rf $T
