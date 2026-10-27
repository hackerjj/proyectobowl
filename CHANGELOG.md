# Changelog

Historial de cambios de Proyecto Bowl (calculadora y backend). Lo más reciente arriba.
La misma lista vive en el chip de versión del sitio (clic en "vX.Y" junto al título).

## v1.2 — 27 oct 2026 · 14:16
### Agregado
- PIN personal para Jair y para Andrea. El sistema reconoce quién guarda por su PIN; ya no
  hay que escribir el nombre.
- Indicador de sesión junto al estado y botón "Cerrar sesión".
- Chip de versión y popup de historial de cambios.
### Cambiado
- Se quitó el PIN compartido. El backend lee `BOWL_USERS` ("Nombre:PIN,Nombre:PIN") y pone
  el nombre de quien guarda; el navegador ya no lo manda.
- El PIN se valida contra `/api/whoami` al entrar.

## v1.1 — 27 oct 2026 · 14:09
### Agregado
- Backend en Render (`proyectobowl-backend`, Node, plan free) con datos en el Mongo
  compartido de Sushi, aislados en `bowl_data` y `bowl_history`.
- Historial de versiones (hasta 100) con opción de restaurar como borrador.
- Aviso de conflicto cuando dos personas guardan al mismo tiempo.
- Aviso de "Despertando el servidor" y copia de respaldo si Render no responde.
### Cambiado
- Guardar ya no escribe en GitHub ni pide token; usa la API de Render.

## v1.0 — 27 oct 2026 · 12:40
### Agregado
- Calculadora de costos y márgenes: comisión, IVA, retenciones, descuento y precio mínimo.
- Proyección mensual: utilidad, pedidos al día para no perder, recuperación de contenedores.
- Insumos y recetas editables (5 bowls, 2 cafés, agua mineral).
- Pestaña de análisis con plan de arranque, impuestos, menú y operación.
- Publicado en GitHub Pages.
