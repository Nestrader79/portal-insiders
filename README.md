# Radar de Insiders

Portal gratuito con datos públicos de EE. UU.:

- **Insiders**: compras y ventas de directivos y grandes accionistas (Form 4 de la SEC).
- **Congreso**: operaciones de congresistas (Cámara: fuente oficial; Senado: API gratuita de Bargo).
- **Retail**: acciones más mencionadas en Reddit (ApeWisdom).
- **Ventas en corto**: volumen diario en corto de FINRA.

Se actualiza cuando presionas un botón en GitHub y se publica gratis en GitHub Pages.

---

## Instalación (una sola vez, unos 15 minutos)

### 1. Crear la cuenta y el repositorio
1. Crea una cuenta gratis en https://github.com.
2. Arriba a la derecha, haz clic en **+** y luego en **New repository**.
3. En *Repository name* escribe `portal-insiders`, elige **Public** y haz clic en **Create repository**.
   (GitHub Pages es gratis con repositorios públicos.)

### 2. Subir los archivos
1. En el repositorio recién creado, haz clic en el enlace **uploading an existing file**.
2. Descomprime el ZIP en tu computador, abre la carpeta `portal-insiders` y **arrastra todo su contenido**
   (las carpetas `docs` y `scripts` y los archivos `README.md` y `requirements.txt`) a la página de GitHub.
3. Abajo, haz clic en **Commit changes**.

### 3. Crear el archivo del botón de actualización
La carpeta `.github` suele quedar oculta en el computador, así que es más fácil crearla a mano:
1. En el repositorio, haz clic en **Add file**, luego en **Create new file**.
2. En el nombre escribe exactamente: `.github/workflows/actualizar.yml`
3. Abre el archivo `actualizar.yml` del ZIP (que está en la carpeta `.github/workflows`), copia todo su contenido y pégalo.
4. Haz clic en **Commit changes**.

### 4. Configurar tu identificación para la SEC (obligatorio)
La SEC exige que cada descarga incluya un nombre y un email de contacto.
1. Ve a **Settings**, luego a **Secrets and variables** y después a **Actions**.
2. Haz clic en **New repository secret**.
3. En *Name* escribe `SEC_USER_AGENT`. En *Secret* escribe tu nombre y email, por ejemplo: `Juan Perez juan@email.com`.
4. Haz clic en **Add secret**.

Opcional: si sacas una clave gratis en https://www.bargo.ai/free-apis/dash, crea otro secreto llamado `BARGO_API_KEY`.
Así recibes más datos del Senado (1,000 filas al día en vez de 100).

### 5. Activar GitHub Pages
1. Ve a **Settings** y después a **Pages**.
2. En *Build and deployment*, dentro de *Source*, elige **GitHub Actions**.

### 6. Primera actualización
1. Ve a la pestaña **Actions**. Si GitHub lo pregunta, haz clic en el botón verde para habilitar los workflows.
2. En la izquierda, elige **Actualizar datos**, luego **Run workflow**, escribe `7` en días y haz clic en **Run workflow**.
3. Espera entre 10 y 20 minutos. Cuando aparezca el ✅, tu portal estará en
   `https://TU-USUARIO.github.io/portal-insiders/`.

---

## Uso diario
Pestaña **Actions**, luego **Actualizar datos** y después **Run workflow**. Con 3 días alcanza si actualizas cada uno o dos días.
Tarda unos 5 a 10 minutos.

Para que se actualice solo, edita `.github/workflows/actualizar.yml` y quita los `#` de las líneas `schedule`.

## Notas
- Los índices de la SEC del día se publican en la noche (hora de EE. UU.), así que lo de hoy aparece mañana.
- Los congresistas tienen hasta 45 días para reportar; esos datos siempre llegan con retraso.
- Los PDF de la Cámara se leen de forma automática. Si un PDF es escaneado, aparece como "Ver PDF" con su enlace.
- Si una fuente falla, las demás se actualizan igual. El estado de cada una se ve arriba a la derecha en el portal.
- Los datos de FINRA son gratuitos solo para uso no comercial. Los de Bargo requieren mostrar el enlace a Bargo, que ya aparece en el pie de página.
- Nada de esto es asesoría de inversión.

## Ejecutar en tu computador (opcional)
```bash
pip install -r requirements.txt
export SEC_USER_AGENT="Tu Nombre tu@email.com"
python scripts/actualizar.py --dias 3
cd docs && python -m http.server 8000   # abre http://localhost:8000
```
