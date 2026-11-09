// Las pruebas fuerzan AUTH=off por su cuenta: el .env local puede traer AUTH=on para probar el login.
// Las pruebas de autenticación lo activan explícitamente y restauran este valor.
process.env.AUTH = "off"
