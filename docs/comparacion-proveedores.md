# Comparación de proveedores: Corp Andina de punta a punta

Medido el 2026-11-09: primer turno del PRD §11 (prompt completo) 5 veces por proveedor, secuencial, sesión nueva en cada corrida, fecha de referencia 2026-09-03.

Una corrida cuenta como **éxito** solo si llamó las 4 herramientas, pidió confirmación, mencionó el faltante, el soporte ausente y el RUC por confirmar, y reportó 13 campos llenos. Tiempos: mínimo / mediana / máximo en segundos. Tokens: promedio por corrida (entrada + salida) tal como los reporta el proveedor.

| Configuración | Modelo | Éxitos | Tiempo (s) mín / med / máx | Tokens | Cambios de proveedor | Motivos de fallo |
|---|---|---|---|---|---|---|
| openai | gpt-4.1-mini | 5/5 | 4.3 / 4.7 / 6.1 | 13101 | openai | — |
| google | gemini-3.1-flash-lite | 4/5 | 5.3 / 7.5 / 15.3 | 9354 | google, - | sin confirmación; omite faltante; omite soporte ausente; omite RUC; conteo de llenos ≠ 13; google: límite de velocidad del proveedor |
| deepseek | deepseek-flash | 5/5 | 7.4 / 8.7 / 11.1 | 19116 | deepseek | — |

La cadena se midió aparte, con registro de cambios de proveedor: ver [comparacion-cadena.md](comparacion-cadena.md).
