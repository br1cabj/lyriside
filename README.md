# Lyriside

Extensión para Chrome y Edge que acompaña videos musicales y conciertos de YouTube: detecta canciones, setlists y timestamps sin capturar audio. Lee únicamente información que ya está visible para la persona usuaria: título, canal, descripción y comentarios que YouTube haya cargado en la página.

## Qué resuelve esta primera versión

- Detecta líneas con marcas de tiempo, por ejemplo `12:43 Artista - Canción`.
- Detecta listas numeradas bajo encabezados como `Setlist`, `Tracklist` o `Canciones`.
- Combina resultados de la descripción con comentarios visibles y elimina duplicados.
- Muestra los hallazgos en un panel lateral, resalta la canción que está sonando y permite saltar a cualquier timestamp.
- Distingue hallazgos de alta confianza (descripción) y media confianza (comentarios visibles).
- Incluye búsqueda de canciones, vista compacta, temas, favoritos e historial local.
- Permite añadir, editar o quitar canciones; esas correcciones quedan guardadas localmente para el video.

Los comentarios no se cargan ni se recorren automáticamente: YouTube los renderiza de forma dinámica y hacer scroll programático sería invasivo y frágil. Para incluirlos, la persona abre los comentarios, desplaza hasta que aparezcan y pulsa **Actualizar análisis**.

Cuando el setlist contiene timestamps, el panel consulta cada segundo el elemento de video de YouTube. La canción activa es el último timestamp igual o anterior al segundo actual; la siguiente canción es el timestamp posterior. La barra indica el progreso de todo el video. No se captura, almacena ni transmite audio.

## Probarla localmente

1. Abre `chrome://extensions` en Chrome o `edge://extensions` en Edge.
2. Activa el modo desarrollador.
3. Elige **Cargar descomprimida** y selecciona la carpeta raíz que clonaste del repositorio.
4. Entra a un video de YouTube, abre la extensión y pulsa su icono para mostrar el panel lateral.

## Estructura

```text
src/
├─ background/   # Coordinación de la extensión y acciones del panel
├─ content/      # Lectura de metadatos y control del reproductor de YouTube
└─ sidepanel/    # Interfaz, setlist, historial y preferencias locales
```

## Privacidad

Lyriside no graba ni transmite el audio del video. Analiza únicamente texto y estado del reproductor que ya están disponibles en la página de YouTube. El historial, favoritos y correcciones se almacenan localmente en el navegador.

## Diseño para la siguiente fase

La identificación por metadatos vive en `src/content/youtube-metadata.js`. Un futuro proveedor de letras debe integrarse detrás de un backend propio, por ejemplo:

```text
panel lateral → backend propio → API de letras autorizada
```

No incluyas claves de API en `manifest.json`, en el panel ni en el content script. El backend debe validar la petición, aplicar límites y devolver un formato propio como `{ title, artist, lyrics, syncedLines }`.

Actualmente, **Ver letra** abre una búsqueda externa. La visualización de letras completas dentro de Lyriside debe conectarse solo a un proveedor autorizado y respetar sus condiciones de licencia, atribución y caché.

Para mejorar la detección de conciertos, la próxima iteración puede consultar fuentes de setlists autorizadas con el título, canal y fecha del video, y después mostrar al usuario una coincidencia para que la confirme.
