// A small JSON Schema (2020-12) checker for the shot-plan language (web/export/shot-plan.schema.json): the keywords that schema uses ($ref to
// $defs, type, const, enum, required, properties, additionalProperties, minProperties, items, minItems, maxItems, minLength, maxLength, pattern,
// minimum, maximum, oneOf, anyOf, allOf, not, if/then), so a plan can be checked in node and in the page with no library. Pure.
//   checkSchema(schema, value) -> [{path, message}] (empty: valid)
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v)
const isType = (v, t) => (t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "integer" ? Number.isInteger(v) : typeOf(v) === t)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function checkSchema(schema, value) {
	const root = schema
	const resolve = (ref) => {
		if (!ref.startsWith("#/")) throw new Error(`schema: only local $refs are understood (${ref})`)
		return ref
			.slice(2)
			.split("/")
			.reduce((o, k) => o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], root)
	}
	const check = (s, v, path, out) => {
		if (s === true || s === undefined) return
		if (s === false) return out.push({ path, message: "is not allowed" })
		if (s.$ref) check(resolve(s.$ref), v, path, out)
		if (s.type !== undefined && ![].concat(s.type).some((t) => isType(v, t))) return out.push({ path, message: `must be ${[].concat(s.type).join(" or ")} (got ${typeOf(v)})` })
		if (s.const !== undefined && !same(s.const, v)) out.push({ path, message: `must be ${JSON.stringify(s.const)}` })
		if (s.enum && !s.enum.some((e) => same(e, v))) out.push({ path, message: `must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")} (got ${JSON.stringify(v)})` })
		if (typeof v === "string") {
			if (s.minLength !== undefined && [...v].length < s.minLength) out.push({ path, message: `must be at least ${s.minLength} characters` })
			if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push({ path, message: `must be at most ${s.maxLength} characters` })
			if (s.pattern && !new RegExp(s.pattern, "u").test(v)) out.push({ path, message: `must match ${s.pattern} (got ${JSON.stringify(v)})` })
		}
		if (typeof v === "number") {
			if (s.minimum !== undefined && v < s.minimum) out.push({ path, message: `must be at least ${s.minimum}` })
			if (s.maximum !== undefined && v > s.maximum) out.push({ path, message: `must be at most ${s.maximum}` })
		}
		if (Array.isArray(v)) {
			if (s.minItems !== undefined && v.length < s.minItems) out.push({ path, message: `must have at least ${s.minItems} item(s)` })
			if (s.maxItems !== undefined && v.length > s.maxItems) out.push({ path, message: `must have at most ${s.maxItems} items` })
			if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out))
		}
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const keys = Object.keys(v)
			if (s.minProperties !== undefined && keys.length < s.minProperties) out.push({ path, message: `must have at least ${s.minProperties} key(s)` })
			for (const k of s.required ?? []) if (!(k in v)) out.push({ path, message: `needs ${k}` })
			for (const k of keys) {
				if (s.properties && k in s.properties) check(s.properties[k], v[k], `${path}.${k}`, out)
				else if (s.additionalProperties === false) out.push({ path, message: `has ${k}, which is not one of its fields` })
				else if (s.additionalProperties && typeof s.additionalProperties === "object") check(s.additionalProperties, v[k], `${path}.${k}`, out)
			}
		}
		if (s.allOf) for (const x of s.allOf) check(x, v, path, out)
		if (s.anyOf && !s.anyOf.some((x) => !errs(x, v, path).length)) out.push({ path, message: "matches none of its allowed forms" })
		if (s.oneOf) {
			const fits = s.oneOf.map((x) => errs(x, v, path))
			const n = fits.filter((e) => !e.length).length
			if (n !== 1) {
				if (n > 1) out.push({ path, message: "matches more than one of its forms" })
				else {
					// (the closest form's messages: the fewest errors)
					const best = fits.reduce((a, b) => (b.length < a.length ? b : a))
					out.push({ path, message: `matches none of its forms${best.length ? `; closest: ${best[0].path} ${best[0].message}` : ""}` })
				}
			}
		}
		if (s.not && !errs(s.not, v, path).length) out.push({ path, message: "is a form that is not allowed here" })
		if (s.if && !errs(s.if, v, path).length && s.then) check(s.then, v, path, out)
	}
	const errs = (s, v, path) => {
		const out = []
		check(s, v, path, out)
		return out
	}
	return errs(schema, value, "plan")
}
