import { type ConfigField, type Msg, type RuleSet, msg } from '../types';
import { polaco } from './polaco';

/**
 * Registro de sets de reglas. Para añadir una variante: crea su fichero en
 * lib/rules/, implementa `RuleSet` y regístralo aquí.
 */
type AnyRuleSet = RuleSet<any, any, any>;

const registry: Record<string, AnyRuleSet> = {
  [polaco.id]: polaco
};

export const DEFAULT_RULESET_ID = polaco.id;

export function getRuleSet(id: string): AnyRuleSet | null {
  return Object.hasOwn(registry, id) ? registry[id] : null;
}

export function defaultConfig(fields: ConfigField[]): Record<string, number> {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

/** Valida y normaliza la config contra los campos del set (rellena defaults, rechaza fuera de rango). */
export function normalizeConfig(
  fields: ConfigField[],
  raw: unknown
): { ok: true; config: Record<string, number> } | { ok: false; error: Msg } {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const config: Record<string, number> = {};
  for (const f of fields) {
    const v = input[f.key] ?? f.default;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) {
      return {
        ok: false,
        error: msg('error.configOutOfRange', { field: msg(`field.${f.key}`), min: f.min, max: f.max })
      };
    }
    config[f.key] = v;
  }
  return { ok: true, config };
}
