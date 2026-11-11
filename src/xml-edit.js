// Element-scoped edits of .csproj and .nuspec text. Only the version value changes; every other byte is kept.

const PACKAGE_REF = /<PackageReference\b[^>]*?(?:\/>|>[\s\S]*?<\/PackageReference>)/g;

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

function openingTag(element) {
  return /^<[^>]*>/.exec(element)[0];
}

function versionOf(element) {
  const a = attr(openingTag(element), 'Version');
  if (a !== null) return a;
  const child = /<Version>([^<]*)<\/Version>/.exec(element);
  return child ? child[1] : null;
}

function withVersion(element, version) {
  const tag = openingTag(element);
  if (attr(tag, 'Version') !== null) {
    return element.replace(tag, tag.replace(/(\bVersion\s*=\s*")[^"]*(")/i, `$1${version}$2`));
  }
  return element.replace(/(<Version>)[^<]*(<\/Version>)/, `$1${version}$2`);
}

export function listPackageRefs(xml) {
  const refs = [];
  for (const [el] of xml.matchAll(PACKAGE_REF)) {
    const id = attr(openingTag(el), 'Include');
    const version = versionOf(el);
    if (id !== null && version !== null) refs.push({ id, version });
  }
  return refs;
}

export function listProjectRefs(xml) {
  return [...xml.matchAll(/<ProjectReference\b[^>]*>/g)].map((m) => attr(m[0], 'Include')).filter((v) => v !== null);
}

export function setPackageRefVersion(xml, id, version) {
  const old = [];
  const out = xml.replace(PACKAGE_REF, (el) => {
    const include = attr(openingTag(el), 'Include');
    const current = versionOf(el);
    if (include === null || include.toLowerCase() !== id.toLowerCase() || current === null) return el;
    old.push(current);
    return withVersion(el, version);
  });
  return { xml: out, old, changed: old.length > 0 };
}

export function setPackageRefVersions(xml, id, versions) {
  const total = [...xml.matchAll(PACKAGE_REF)].filter(([el]) => attr(openingTag(el), 'Include')?.toLowerCase() === id.toLowerCase() && versionOf(el) !== null).length;
  if (total !== versions.length) throw new Error(`${id} has ${total} occurrences but ${versions.length} versions were given`);
  let i = 0;
  return xml.replace(PACKAGE_REF, (el) => {
    const include = attr(openingTag(el), 'Include');
    if (include === null || include.toLowerCase() !== id.toLowerCase() || versionOf(el) === null) return el;
    return withVersion(el, versions[i++]);
  });
}

export function getProjectVersion(xml) {
  for (const m of xml.matchAll(/<PropertyGroup\b[^>]*>[\s\S]*?<\/PropertyGroup>/g)) {
    const v = /<Version>([^<]*)<\/Version>/.exec(m[0]);
    if (v) return v[1];
  }
  throw new Error('project has no <Version> in a <PropertyGroup>');
}

export function hasProjectVersion(xml) {
  return [...xml.matchAll(/<PropertyGroup\b[^>]*>[\s\S]*?<\/PropertyGroup>/g)].some((m) => /<Version>[^<]*<\/Version>/.test(m[0]));
}

export function setProjectVersion(xml, version) {
  const group = /<PropertyGroup\b[^>]*>[\s\S]*?<\/PropertyGroup>/g;
  for (const m of xml.matchAll(group)) {
    if (!/<Version>[^<]*<\/Version>/.test(m[0])) continue;
    const edited = m[0].replace(/(<Version>)[^<]*(<\/Version>)/, `$1${version}$2`);
    return xml.slice(0, m.index) + edited + xml.slice(m.index + m[0].length);
  }
  throw new Error('project has no <Version> in a <PropertyGroup>');
}

export function setNuspecVersion(xml, version) {
  const meta = /<metadata\b[^>]*>[\s\S]*?<\/metadata>/.exec(xml);
  if (!meta || !/<version>[^<]*<\/version>/.test(meta[0])) throw new Error('nuspec has no <version> in <metadata>');
  const edited = meta[0].replace(/(<version>)[^<]*(<\/version>)/, `$1${version}$2`);
  return xml.slice(0, meta.index) + edited + xml.slice(meta.index + meta[0].length);
}

export function setNuspecDependency(xml, id, version) {
  const old = [];
  const out = xml.replace(/<dependency\b[^>]*>/g, (tag) => {
    const depId = attr(tag, 'id');
    const current = attr(tag, 'version');
    if (depId === null || depId.toLowerCase() !== id.toLowerCase() || current === null) return tag;
    old.push(current);
    return tag.replace(/(\bversion\s*=\s*")[^"]*(")/, `$1${version}$2`);
  });
  return { xml: out, old, changed: old.length > 0 };
}
