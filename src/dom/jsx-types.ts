/**
 * pimas — JSX intrinsic-element types.
 *
 * The design goals, in order:
 *  1. Catch the common mistakes: misspelled element names (`<dvi>`), and unknown
 *     attributes on the elements that have a well-known shape.
 *  2. Never get in the way of real usage: every attribute may also be a reactive
 *     THUNK (`class={() => cls()}`), `data-*`/`aria-*` are always allowed, custom
 *     elements (any tag containing a hyphen) are allowed, and event handlers accept
 *     either a closure or a serializable `HandlerDescriptor` (the pimas `listen` seam).
 *
 * Deliberately pragmatic, not exhaustive: HTML elements are typed to a useful
 * common surface; SVG is intentionally permissive (its attribute space is huge and
 * heavily hyphenated) — SVG elements accept any attribute but still get typed
 * events/ref/class. Tighten incrementally; see issue #18.
 */
import type { Child, Handler } from "./engine.js";

/** Any attribute value may be static, or a reactive thunk re-read on change. */
type Dyn<T> = T | (() => T);

/** A ref callback receives the live element (a no-op under SSR). */
type Ref<E> = (el: E) => void;

/** Loose style object — kebab-cased by the renderer; string form also accepted. */
export interface CSSProperties {
  [key: string]: string | number | undefined;
}

/** The DOM events wired most often, typed to their native event objects. Each is
 *  a `Handler` — a closure or a serializable descriptor. Unlisted events are still
 *  reachable via the `on${string}` index signature on {@link DOMAttributes}. */
export interface DOMEventHandlers {
  onClick?: Handler<MouseEvent>;
  onDblClick?: Handler<MouseEvent>;
  onMouseDown?: Handler<MouseEvent>;
  onMouseUp?: Handler<MouseEvent>;
  onMouseMove?: Handler<MouseEvent>;
  onMouseEnter?: Handler<MouseEvent>;
  onMouseLeave?: Handler<MouseEvent>;
  onMouseOver?: Handler<MouseEvent>;
  onMouseOut?: Handler<MouseEvent>;
  onContextMenu?: Handler<MouseEvent>;
  onPointerDown?: Handler<PointerEvent>;
  onPointerUp?: Handler<PointerEvent>;
  onPointerMove?: Handler<PointerEvent>;
  onPointerEnter?: Handler<PointerEvent>;
  onPointerLeave?: Handler<PointerEvent>;
  onPointerCancel?: Handler<PointerEvent>;
  onTouchStart?: Handler<TouchEvent>;
  onTouchEnd?: Handler<TouchEvent>;
  onTouchMove?: Handler<TouchEvent>;
  onWheel?: Handler<WheelEvent>;
  onScroll?: Handler<Event>;
  onKeyDown?: Handler<KeyboardEvent>;
  onKeyUp?: Handler<KeyboardEvent>;
  onKeyPress?: Handler<KeyboardEvent>;
  onInput?: Handler<InputEvent>;
  onChange?: Handler<Event>;
  onBeforeInput?: Handler<InputEvent>;
  onSubmit?: Handler<SubmitEvent>;
  onReset?: Handler<Event>;
  onInvalid?: Handler<Event>;
  onFocus?: Handler<FocusEvent>;
  onBlur?: Handler<FocusEvent>;
  onFocusIn?: Handler<FocusEvent>;
  onFocusOut?: Handler<FocusEvent>;
  onCopy?: Handler<ClipboardEvent>;
  onCut?: Handler<ClipboardEvent>;
  onPaste?: Handler<ClipboardEvent>;
  onDragStart?: Handler<DragEvent>;
  onDrag?: Handler<DragEvent>;
  onDragEnd?: Handler<DragEvent>;
  onDragEnter?: Handler<DragEvent>;
  onDragOver?: Handler<DragEvent>;
  onDragLeave?: Handler<DragEvent>;
  onDrop?: Handler<DragEvent>;
  onLoad?: Handler<Event>;
  onError?: Handler<Event>;
  onAnimationStart?: Handler<AnimationEvent>;
  onAnimationEnd?: Handler<AnimationEvent>;
  onTransitionEnd?: Handler<TransitionEvent>;
}

/** Props common to every element: children, ref, events, and the two escape
 *  hatches (`data-*`/`aria-*`, and any other `on*` event). */
export interface DOMAttributes<E> extends DOMEventHandlers {
  children?: Child;
  ref?: Ref<E>;
  /** Any `data-*` attribute. */
  [dataAttr: `data-${string}`]: unknown;
  /** Any `aria-*` attribute. */
  [ariaAttr: `aria-${string}`]: unknown;
  /** Any other `on*` event not named above. */
  [event: `on${string}`]: Handler<any> | undefined;
}

/** Global HTML attributes valid on any HTML element. */
export interface HTMLAttributes<E = HTMLElement> extends DOMAttributes<E> {
  id?: Dyn<string>;
  class?: Dyn<string>;
  className?: Dyn<string>;
  style?: Dyn<string | CSSProperties>;
  title?: Dyn<string>;
  role?: Dyn<string>;
  hidden?: Dyn<boolean>;
  tabIndex?: Dyn<number>;
  tabindex?: Dyn<number>;
  lang?: Dyn<string>;
  dir?: Dyn<"ltr" | "rtl" | "auto">;
  draggable?: Dyn<boolean>;
  spellcheck?: Dyn<boolean>;
  contentEditable?: Dyn<boolean | "true" | "false" | "plaintext-only" | "inherit">;
  contenteditable?: Dyn<boolean | "true" | "false" | "plaintext-only" | "inherit">;
  accessKey?: Dyn<string>;
  autoFocus?: Dyn<boolean>;
  autofocus?: Dyn<boolean>;
  slot?: Dyn<string>;
  inert?: Dyn<boolean>;
  translate?: Dyn<"yes" | "no">;
  enterKeyHint?: Dyn<string>;
  inputMode?: Dyn<string>;
  inputmode?: Dyn<string>;
  popover?: Dyn<string>;
  is?: Dyn<string>;
  /** Set the `innerHTML` property directly (the renderer sets it as a property). */
  innerHTML?: Dyn<string>;
}

// ── Element-specific attribute sets ─────────────────────────────────────────

export interface AnchorHTMLAttributes extends HTMLAttributes<HTMLAnchorElement> {
  href?: Dyn<string>;
  target?: Dyn<string>;
  rel?: Dyn<string>;
  download?: Dyn<string | boolean>;
  hreflang?: Dyn<string>;
  ping?: Dyn<string>;
  referrerPolicy?: Dyn<string>;
  type?: Dyn<string>;
}

export interface ButtonHTMLAttributes extends HTMLAttributes<HTMLButtonElement> {
  type?: Dyn<"submit" | "reset" | "button">;
  disabled?: Dyn<boolean>;
  name?: Dyn<string>;
  value?: Dyn<string | number>;
  form?: Dyn<string>;
  formAction?: Dyn<string>;
  formMethod?: Dyn<string>;
  formNoValidate?: Dyn<boolean>;
  formTarget?: Dyn<string>;
  autofocus?: Dyn<boolean>;
}

export interface InputHTMLAttributes extends HTMLAttributes<HTMLInputElement> {
  type?: Dyn<string>;
  value?: Dyn<string | number>;
  checked?: Dyn<boolean>;
  disabled?: Dyn<boolean>;
  readOnly?: Dyn<boolean>;
  required?: Dyn<boolean>;
  placeholder?: Dyn<string>;
  name?: Dyn<string>;
  min?: Dyn<string | number>;
  max?: Dyn<string | number>;
  step?: Dyn<string | number>;
  minLength?: Dyn<number>;
  maxLength?: Dyn<number>;
  pattern?: Dyn<string>;
  multiple?: Dyn<boolean>;
  accept?: Dyn<string>;
  autoComplete?: Dyn<string>;
  autocomplete?: Dyn<string>;
  autofocus?: Dyn<boolean>;
  list?: Dyn<string>;
  size?: Dyn<number>;
  form?: Dyn<string>;
  capture?: Dyn<string | boolean>;
}

export interface TextareaHTMLAttributes extends HTMLAttributes<HTMLTextAreaElement> {
  value?: Dyn<string>;
  placeholder?: Dyn<string>;
  name?: Dyn<string>;
  rows?: Dyn<number>;
  cols?: Dyn<number>;
  disabled?: Dyn<boolean>;
  readOnly?: Dyn<boolean>;
  required?: Dyn<boolean>;
  maxLength?: Dyn<number>;
  minLength?: Dyn<number>;
  wrap?: Dyn<string>;
  form?: Dyn<string>;
  autofocus?: Dyn<boolean>;
}

export interface SelectHTMLAttributes extends HTMLAttributes<HTMLSelectElement> {
  value?: Dyn<string | number>;
  name?: Dyn<string>;
  disabled?: Dyn<boolean>;
  required?: Dyn<boolean>;
  multiple?: Dyn<boolean>;
  size?: Dyn<number>;
  form?: Dyn<string>;
  autofocus?: Dyn<boolean>;
}

export interface OptionHTMLAttributes extends HTMLAttributes<HTMLOptionElement> {
  value?: Dyn<string | number>;
  selected?: Dyn<boolean>;
  disabled?: Dyn<boolean>;
  label?: Dyn<string>;
}

export interface LabelHTMLAttributes extends HTMLAttributes<HTMLLabelElement> {
  for?: Dyn<string>;
  htmlFor?: Dyn<string>;
  form?: Dyn<string>;
}

export interface FormHTMLAttributes extends HTMLAttributes<HTMLFormElement> {
  action?: Dyn<string>;
  method?: Dyn<string>;
  target?: Dyn<string>;
  name?: Dyn<string>;
  autoComplete?: Dyn<string>;
  autocomplete?: Dyn<string>;
  noValidate?: Dyn<boolean>;
  encType?: Dyn<string>;
  acceptCharset?: Dyn<string>;
}

export interface ImgHTMLAttributes extends HTMLAttributes<HTMLImageElement> {
  src?: Dyn<string>;
  alt?: Dyn<string>;
  srcset?: Dyn<string>;
  srcSet?: Dyn<string>;
  sizes?: Dyn<string>;
  width?: Dyn<number | string>;
  height?: Dyn<number | string>;
  loading?: Dyn<"eager" | "lazy">;
  decoding?: Dyn<"async" | "auto" | "sync">;
  crossOrigin?: Dyn<string>;
  referrerPolicy?: Dyn<string>;
  usemap?: Dyn<string>;
}

export interface ScriptHTMLAttributes extends HTMLAttributes<HTMLScriptElement> {
  src?: Dyn<string>;
  type?: Dyn<string>;
  async?: Dyn<boolean>;
  defer?: Dyn<boolean>;
  noModule?: Dyn<boolean>;
  crossOrigin?: Dyn<string>;
  integrity?: Dyn<string>;
  referrerPolicy?: Dyn<string>;
}

export interface LinkHTMLAttributes extends HTMLAttributes<HTMLLinkElement> {
  href?: Dyn<string>;
  rel?: Dyn<string>;
  type?: Dyn<string>;
  media?: Dyn<string>;
  sizes?: Dyn<string>;
  as?: Dyn<string>;
  crossOrigin?: Dyn<string>;
  integrity?: Dyn<string>;
  referrerPolicy?: Dyn<string>;
}

export interface MetaHTMLAttributes extends HTMLAttributes<HTMLMetaElement> {
  name?: Dyn<string>;
  content?: Dyn<string>;
  charset?: Dyn<string>;
  httpEquiv?: Dyn<string>;
  property?: Dyn<string>;
}

export interface MediaHTMLAttributes<E> extends HTMLAttributes<E> {
  src?: Dyn<string>;
  controls?: Dyn<boolean>;
  autoplay?: Dyn<boolean>;
  loop?: Dyn<boolean>;
  muted?: Dyn<boolean>;
  preload?: Dyn<string>;
  crossOrigin?: Dyn<string>;
}

export interface VideoHTMLAttributes extends MediaHTMLAttributes<HTMLVideoElement> {
  poster?: Dyn<string>;
  width?: Dyn<number | string>;
  height?: Dyn<number | string>;
  playsInline?: Dyn<boolean>;
}

export interface SourceHTMLAttributes extends HTMLAttributes<HTMLSourceElement> {
  src?: Dyn<string>;
  type?: Dyn<string>;
  srcset?: Dyn<string>;
  srcSet?: Dyn<string>;
  sizes?: Dyn<string>;
  media?: Dyn<string>;
}

export interface IframeHTMLAttributes extends HTMLAttributes<HTMLIFrameElement> {
  src?: Dyn<string>;
  srcdoc?: Dyn<string>;
  name?: Dyn<string>;
  width?: Dyn<number | string>;
  height?: Dyn<number | string>;
  allow?: Dyn<string>;
  allowFullScreen?: Dyn<boolean>;
  loading?: Dyn<"eager" | "lazy">;
  referrerPolicy?: Dyn<string>;
  sandbox?: Dyn<string>;
}

export interface TdHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
  colSpan?: Dyn<number>;
  colspan?: Dyn<number>;
  rowSpan?: Dyn<number>;
  rowspan?: Dyn<number>;
  headers?: Dyn<string>;
  scope?: Dyn<string>;
}

export interface ColHTMLAttributes extends HTMLAttributes<HTMLTableColElement> {
  span?: Dyn<number>;
}

export interface OlHTMLAttributes extends HTMLAttributes<HTMLOListElement> {
  start?: Dyn<number>;
  reversed?: Dyn<boolean>;
  type?: Dyn<string>;
}

export interface LiHTMLAttributes extends HTMLAttributes<HTMLLIElement> {
  value?: Dyn<number>;
}

export interface ProgressHTMLAttributes extends HTMLAttributes<HTMLProgressElement> {
  value?: Dyn<number | string>;
  max?: Dyn<number | string>;
}

export interface MeterHTMLAttributes extends HTMLAttributes<HTMLMeterElement> {
  value?: Dyn<number | string>;
  min?: Dyn<number | string>;
  max?: Dyn<number | string>;
  low?: Dyn<number | string>;
  high?: Dyn<number | string>;
  optimum?: Dyn<number | string>;
  form?: Dyn<string>;
}

export interface DetailsHTMLAttributes extends HTMLAttributes<HTMLDetailsElement> {
  open?: Dyn<boolean>;
}

export interface DialogHTMLAttributes extends HTMLAttributes<HTMLDialogElement> {
  open?: Dyn<boolean>;
}

export interface CanvasHTMLAttributes extends HTMLAttributes<HTMLCanvasElement> {
  width?: Dyn<number | string>;
  height?: Dyn<number | string>;
}

export interface FieldsetHTMLAttributes extends HTMLAttributes<HTMLFieldSetElement> {
  disabled?: Dyn<boolean>;
  form?: Dyn<string>;
  name?: Dyn<string>;
}

export interface OutputHTMLAttributes extends HTMLAttributes<HTMLOutputElement> {
  for?: Dyn<string>;
  htmlFor?: Dyn<string>;
  form?: Dyn<string>;
  name?: Dyn<string>;
}

export interface TimeHTMLAttributes extends HTMLAttributes<HTMLTimeElement> {
  dateTime?: Dyn<string>;
}

export interface DataHTMLAttributes extends HTMLAttributes<HTMLDataElement> {
  value?: Dyn<string | number>;
}

/**
 * SVG element attributes. Intentionally permissive: SVG has a very large,
 * heavily-hyphenated attribute surface, so any attribute is accepted (as a value
 * or thunk) while events/ref/class stay typed. Tighten later if it earns its keep.
 */
export interface SVGAttributes extends DOMAttributes<SVGElement> {
  id?: Dyn<string>;
  class?: Dyn<string>;
  className?: Dyn<string>;
  style?: Dyn<string | CSSProperties>;
  [attr: string]: unknown;
}

// ── The intrinsic-element registry ──────────────────────────────────────────

type HTML<E = HTMLElement> = HTMLAttributes<E>;

export interface IntrinsicElements {
  // Document / sections
  a: AnchorHTMLAttributes;
  abbr: HTML;
  address: HTML;
  article: HTML;
  aside: HTML;
  b: HTML;
  bdi: HTML;
  bdo: HTML;
  blockquote: HTML<HTMLQuoteElement>;
  br: HTML<HTMLBRElement>;
  button: ButtonHTMLAttributes;
  canvas: CanvasHTMLAttributes;
  caption: HTML;
  cite: HTML;
  code: HTML;
  col: ColHTMLAttributes;
  colgroup: ColHTMLAttributes;
  data: DataHTMLAttributes;
  datalist: HTML<HTMLDataListElement>;
  dd: HTML;
  del: HTML<HTMLModElement>;
  details: DetailsHTMLAttributes;
  dfn: HTML;
  dialog: DialogHTMLAttributes;
  div: HTML<HTMLDivElement>;
  dl: HTML<HTMLDListElement>;
  dt: HTML;
  em: HTML;
  embed: HTML<HTMLEmbedElement>;
  fieldset: FieldsetHTMLAttributes;
  figcaption: HTML;
  figure: HTML;
  footer: HTML;
  form: FormHTMLAttributes;
  h1: HTML<HTMLHeadingElement>;
  h2: HTML<HTMLHeadingElement>;
  h3: HTML<HTMLHeadingElement>;
  h4: HTML<HTMLHeadingElement>;
  h5: HTML<HTMLHeadingElement>;
  h6: HTML<HTMLHeadingElement>;
  header: HTML;
  hgroup: HTML;
  hr: HTML<HTMLHRElement>;
  i: HTML;
  iframe: IframeHTMLAttributes;
  img: ImgHTMLAttributes;
  input: InputHTMLAttributes;
  ins: HTML<HTMLModElement>;
  kbd: HTML;
  label: LabelHTMLAttributes;
  legend: HTML<HTMLLegendElement>;
  li: LiHTMLAttributes;
  link: LinkHTMLAttributes;
  main: HTML;
  map: HTML<HTMLMapElement>;
  mark: HTML;
  menu: HTML<HTMLMenuElement>;
  meta: MetaHTMLAttributes;
  meter: MeterHTMLAttributes;
  nav: HTML;
  object: HTML<HTMLObjectElement>;
  ol: OlHTMLAttributes;
  optgroup: HTML<HTMLOptGroupElement>;
  option: OptionHTMLAttributes;
  output: OutputHTMLAttributes;
  p: HTML<HTMLParagraphElement>;
  picture: HTML;
  pre: HTML<HTMLPreElement>;
  progress: ProgressHTMLAttributes;
  q: HTML<HTMLQuoteElement>;
  rp: HTML;
  rt: HTML;
  ruby: HTML;
  s: HTML;
  samp: HTML;
  script: ScriptHTMLAttributes;
  search: HTML;
  section: HTML;
  select: SelectHTMLAttributes;
  small: HTML;
  source: SourceHTMLAttributes;
  span: HTML<HTMLSpanElement>;
  strong: HTML;
  style: HTML<HTMLStyleElement>;
  sub: HTML;
  summary: HTML;
  sup: HTML;
  table: HTML<HTMLTableElement>;
  tbody: HTML<HTMLTableSectionElement>;
  td: TdHTMLAttributes;
  template: HTML<HTMLTemplateElement>;
  textarea: TextareaHTMLAttributes;
  tfoot: HTML<HTMLTableSectionElement>;
  th: TdHTMLAttributes;
  thead: HTML<HTMLTableSectionElement>;
  time: TimeHTMLAttributes;
  tr: HTML<HTMLTableRowElement>;
  track: HTML<HTMLTrackElement>;
  u: HTML;
  ul: HTML<HTMLUListElement>;
  var: HTML;
  video: VideoHTMLAttributes;
  wbr: HTML;

  // SVG (permissive — see SVGAttributes)
  svg: SVGAttributes;
  circle: SVGAttributes;
  clipPath: SVGAttributes;
  defs: SVGAttributes;
  ellipse: SVGAttributes;
  feBlend: SVGAttributes;
  feColorMatrix: SVGAttributes;
  feComposite: SVGAttributes;
  feFlood: SVGAttributes;
  feGaussianBlur: SVGAttributes;
  feMerge: SVGAttributes;
  feMergeNode: SVGAttributes;
  feOffset: SVGAttributes;
  filter: SVGAttributes;
  foreignObject: SVGAttributes;
  g: SVGAttributes;
  image: SVGAttributes;
  line: SVGAttributes;
  linearGradient: SVGAttributes;
  marker: SVGAttributes;
  mask: SVGAttributes;
  path: SVGAttributes;
  pattern: SVGAttributes;
  polygon: SVGAttributes;
  polyline: SVGAttributes;
  radialGradient: SVGAttributes;
  rect: SVGAttributes;
  stop: SVGAttributes;
  symbol: SVGAttributes;
  text: SVGAttributes;
  textPath: SVGAttributes;
  tspan: SVGAttributes;
  use: SVGAttributes;

  /** Custom elements / web components — any tag containing a hyphen. Permissive
   *  by design (their attribute shape is defined by the component, not the DOM). */
  [customElement: `${string}-${string}`]: HTMLAttributes & { [attr: string]: unknown };
}
