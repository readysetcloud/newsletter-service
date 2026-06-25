/**
 * Central resolution of snippet parameters.
 *
 * A snippet declares a typed parameter schema (see the `parameters` field on a
 * snippet record: `string | number | boolean | select | textarea | url`, each
 * with `required`, `defaultValue`, `options`). When a snippet is invoked, the
 * caller supplies raw string attributes (e.g. parsed from a `{{< name a="b" >}}`
 * body shortcode). This module turns those raw strings into the typed data
 * object the snippet's Handlebars content renders against: it applies defaults,
 * enforces `required`, and coerces by `type`.
 *
 * It is pure and side-effect free so it can be unit tested and shared by the
 * body resolver (`parse-md-to-json`) and, later, the template render path — so a
 * snippet behaves identically no matter where it is invoked from.
 */

/**
 * @typedef {Object} SnippetParameter
 * @property {string} name
 * @property {string} type - one of string|number|boolean|select|textarea|url
 * @property {boolean} [required]
 * @property {*} [defaultValue]
 * @property {string[]} [options] - allowed values for `select`
 */

/**
 * Coerce a single raw string value to the parameter's declared type.
 * Returns `{ value }` on success or `{ error }` with a human-readable message.
 * @param {string} raw
 * @param {SnippetParameter} param
 */
const coerce = (raw, param) => {
  switch (param.type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n)
        ? { value: n }
        : { error: `Parameter "${param.name}" must be a number` };
    }
    case 'boolean': {
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: `Parameter "${param.name}" must be "true" or "false"` };
    }
    case 'select': {
      if (Array.isArray(param.options) && param.options.length > 0 && !param.options.includes(raw)) {
        return { error: `Parameter "${param.name}" must be one of: ${param.options.join(', ')}` };
      }
      return { value: raw };
    }
    case 'url':
    case 'string':
    case 'textarea':
    default:
      return { value: raw };
  }
};

/**
 * Resolve raw string attributes against a snippet's parameter schema.
 *
 * Undeclared attributes pass through as-is (strings), so a snippet may use
 * attributes it does not formally declare. Declared parameters get defaults,
 * required-enforcement, and type coercion. On a coercion or required error the
 * issue is collected in `errors` (the caller decides whether to hard-fail or
 * render best-effort); a coercion error keeps the raw string so the block can
 * still render something.
 *
 * @param {SnippetParameter[]} [parameters] - The snippet's declared parameters.
 * @param {Record<string,string>} [rawAttrs] - Raw attributes supplied at the call site.
 * @returns {{ values: Record<string, *>, errors: Array<{name: string, message: string}> }}
 */
export const resolveParameters = (parameters = [], rawAttrs = {}) => {
  const values = { ...rawAttrs };
  const errors = [];

  for (const param of parameters) {
    const hasValue =
      Object.prototype.hasOwnProperty.call(rawAttrs, param.name) && rawAttrs[param.name] !== '';

    if (!hasValue) {
      if (param.defaultValue !== undefined && param.defaultValue !== null) {
        values[param.name] = param.defaultValue;
      } else {
        if (param.required) {
          errors.push({ name: param.name, message: `Missing required parameter "${param.name}"` });
        }
        // Don't pass a declared-but-empty parameter through as "".
        delete values[param.name];
      }
      continue;
    }

    const { value, error } = coerce(rawAttrs[param.name], param);
    if (error) {
      errors.push({ name: param.name, message: error });
      values[param.name] = rawAttrs[param.name];
    } else {
      values[param.name] = value;
    }
  }

  return { values, errors };
};
