#!/usr/bin/env node
// Validates northlight.cloud.json (structure, naming, tags). Read-only; needs no cloud credentials.
const fs = require('fs');
const path = require('path');

const NAME_RULES = {
  resourceGroup: /^rg-[a-z0-9]+-[a-z0-9]+-(prod|dev|test)$/,
  webApp: /^app-[a-z0-9]+-[a-z0-9]+-(prod|dev|test)$/,
  storageAccount: /^st[a-z0-9]{1,22}(prod|dev|test)$/ // 3-24 chars, lowercase alphanumeric
};
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function validate(cfg) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isObj(cfg)) return ['Configuration root must be a JSON object.'];
  const required = Array.isArray(cfg.requiredTags) ? cfg.requiredTags : [];
  ['owner', 'env', 'cost-center'].forEach((t) => { if (!required.includes(t)) err(`requiredTags must include "${t}".`); });
  if (cfg.schemaVersion !== 1) err('schemaVersion must be 1.');
  if (!cfg.provider) err('provider is missing.');
  if (!isObj(cfg.namingConvention) || !isObj(cfg.namingConvention.prefixes)) err('namingConvention.prefixes is missing.');

  const checkTags = (where, tags, env) => {
    if (!isObj(tags)) return err(`${where}: tags are missing.`);
    required.forEach((t) => { if (!tags[t] || typeof tags[t] !== 'string') err(`${where}: required tag "${t}" is missing or empty.`); });
    if (env && tags.env && tags.env !== env) err(`${where}: tag env="${tags.env}" does not match the name suffix "${env}".`);
  };
  const rg = cfg.resourceGroup;
  if (!isObj(rg)) err('resourceGroup is missing.');
  else {
    if (!rg.name) err('resourceGroup.name is missing.');
    else if (!NAME_RULES.resourceGroup.test(rg.name)) err(`resourceGroup.name "${rg.name}" violates the convention rg-<workload>-<component>-<env>.`);
    if (!rg.location) err('resourceGroup.location is missing.');
    checkTags('resourceGroup', rg.tags, rg.name && (rg.name.match(/-(prod|dev|test)$/) || [])[1]);
  }
  if (!Array.isArray(cfg.resources)) err('resources must be an array.');
  else {
    ['webApp', 'storageAccount'].forEach((k) => { if (!cfg.resources.some((r) => r && r.kind === k)) err(`Required resource of kind "${k}" is missing.`); });
    cfg.resources.forEach((r, i) => {
      const w = `resources[${i}]${r && r.name ? ' (' + r.name + ')' : ''}`;
      if (!isObj(r)) return err(`${w}: must be an object.`);
      if (!r.name) err(`${w}: name is missing.`);
      if (!r.type) err(`${w}: type is missing.`);
      if (!NAME_RULES[r.kind]) err(`${w}: unknown kind "${r.kind}".`);
      else if (r.name && !NAME_RULES[r.kind].test(r.name)) err(`${w}: name violates the ${r.kind} naming convention.`);
      checkTags(w, r.tags, r.name && (r.name.match(/(prod|dev|test)$/) || [])[1]);
      if (r.kind === 'storageAccount' && r.settings && r.settings.allowBlobPublicAccess !== false) err(`${w}: allowBlobPublicAccess must be false (accidental data exposure).`);
      if (r.kind === 'webApp' && r.settings && r.settings.httpsOnly !== true) err(`${w}: httpsOnly must be true.`);
    });
  }
  // Never allow secret-looking keys in this file.
  (function scan(o, p) { if (isObj(o)) Object.entries(o).forEach(([k, v]) => { if (/secret|password|token|key$/i.test(k)) err(`${p}.${k}: secret-like key names are not allowed in this file.`); scan(v, p + '.' + k); }); else if (Array.isArray(o)) o.forEach((v, i) => scan(v, `${p}[${i}]`)); })(cfg, '$');
  return errors;
}

if (require.main === module) {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'northlight.cloud.json'));
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`FAIL — cannot read/parse ${path.basename(file)}: ${e.message}`); process.exit(1); }
  const errors = validate(cfg);
  if (errors.length) { console.error(`FAIL — ${errors.length} problem(s) in ${path.basename(file)}:`); errors.forEach((e) => console.error('  - ' + e)); process.exit(1); }
  console.log(`PASS — ${path.basename(file)}: resource group ${cfg.resourceGroup.name}, ${cfg.resources.length} resources, naming and tags valid.`);
}
module.exports = { validate };
