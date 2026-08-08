// Side-effect CSS imports (KaTeX's stylesheet) carry no types of their own.
// The bundler turns them into an injected <style>; the module itself has no
// exports worth describing.
declare module '*.css' {
  const content: string
  export default content
}
