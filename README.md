# Gemini Cookie Converter

Static, client-side converter for Netscape cookie exports.

## GitHub Pages

1. Create a repository.
2. Upload `index.html`.
3. Settings -> Pages -> Deploy from a branch -> `main` / root.
4. Open the resulting GitHub Pages URL.

The converter does not make network requests containing cookie data; parsing and JSON generation happen in the browser.

The generated structure follows the current gemini-web2api README:
`{"cookie":"SID=...; HSID=...; SSID=...; APISID=...; __Secure-1PSID=...","sapisid":"..."}`

Keep exported cookie files private. Do not commit them to Git.
