import fs from 'node:fs';
fs.rmSync('showcase-dist',{recursive:true,force:true});
fs.cpSync('showcase','showcase-dist',{recursive:true});
fs.cpSync('public/brand','showcase-dist/brand',{recursive:true});
console.log('Static source tour built in showcase-dist/. No keys or model calls.');
