# Comparación de proveedores: Corp Andina de punta a punta

Medido el 2026-11-09: primer turno del PRD §11 (prompt completo) 6 veces por proveedor, secuencial, sesión nueva en cada corrida, fecha de referencia 2026-09-03.

Una corrida cuenta como **éxito** solo si llamó las 4 herramientas, pidió confirmación, mencionó el faltante, el soporte ausente y el RUC por confirmar, y reportó 13 campos llenos. Tiempos: mínimo / mediana / máximo en segundos. Tokens: promedio por corrida (entrada + salida) tal como los reporta el proveedor.

| Configuración | Modelo | Éxitos | Tiempo (s) mín / med / máx | Tokens | Cambios de proveedor | Motivos de fallo |
|---|---|---|---|---|---|---|
| cadena google→openai→deepseek | gemini-3.1-flash-lite → gpt-4.1-mini → deepseek-flash | 6/6 | 4.3 / 5.9 / 30.7 | 13779 | 3 de 6 corridas con cambio (google:timeout, google:limite) | — |
