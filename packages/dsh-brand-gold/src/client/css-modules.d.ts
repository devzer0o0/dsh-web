/** CSS Modules are compiled by the shared client preset; declare the shape. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
