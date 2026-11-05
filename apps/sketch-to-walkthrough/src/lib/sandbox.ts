/**
 * Makes `constructor` on every kind of function unreachable in the current realm, so generated code
 * can't climb from a value to the Function constructor (for example
 * `Math['con' + 'structor']['con' + 'structor']('return globalThis')()`) with a key built at run time.
 * Call it once at the top of the disposable sandbox worker, never on the main page.
 * Kept self-contained so tests can run it in a separate realm via its source text.
 */
export function lockDownFunctionConstructors() {
  const kinds = [
    function () {},
    function* () {},
    async function () {},
    async function* () {},
  ];
  for (const fn of kinds) {
    Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', { value: undefined, writable: false, configurable: false });
  }
}
