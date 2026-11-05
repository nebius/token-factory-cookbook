import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
 base:"./",root:folder,publicDir:path.resolve(folder,'../public'),
 resolve:{alias:{'@':path.resolve(folder,'..')},dedupe:['react','react-dom','three']},
 esbuild:{jsx:'automatic'},worker:{format:'es'},
 build:{outDir:path.resolve(folder,'../showcase-dist'),emptyOutDir:true},
 server:{host:'127.0.0.1',port:5174,fs:{allow:[path.resolve(folder,'..')]}}
});
