/**
 * @pimas/dom — the DOM renderer + JSX runtime.
 *
 * Phase 2 (in progress). This package will export:
 *   - render(component, container)   mount a tree into the DOM
 *   - h(tag, props, ...children)     create a real DOM node; wrap dynamic
 *                                    attrs/children in effects from @pimas/reactive
 *   - Fragment
 * and a `@pimas/dom/jsx-runtime` entry for the TS `react-jsx` transform.
 *
 * The boundary is deliberate: the renderer depends on @pimas/reactive, never
 * the reverse. The core stays headless.
 */

export {}; // placeholder so this is a module until Phase 2 lands
