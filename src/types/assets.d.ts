declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.html?raw' {
  const html: string;
  export default html;
}

declare module '*?worker&url' {
  const src: string;
  export default src;
}
