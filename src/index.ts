import express from 'express';
import fs from 'fs/promises';
import fsync from 'fs';
import path from 'path';
import { createReadStream, Stats } from 'fs';
import mime from 'mime-types';

function escapeHtml(unsafe: string): string {
    return unsafe.replace(/[&<>"']/g, (match) => {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}

const app = express();

// 处理所有GET请求
app.get('*', async (req, res) => {
    try {


        const decodedPath = decodeURIComponent(req.path);
        const fullPath = path.join(rootPath, decodedPath);
        console.log(rootPath, decodedPath, fullPath);
        // 防止路径穿越
        if (!path.resolve(fullPath).startsWith(rootPath)) {
            res.status(403).send('Forbidden');
        }



        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
            await sendDirectoryListing(req, res, fullPath);
        } else {
            await sendFile(req, res, fullPath, stat);
        }
    } catch (error: any) {
        handleError(error, res);

    }
});

async function sendDirectoryListing(req: express.Request, res: express.Response, dirPath: string) {
    const files = await fs.readdir(dirPath);
    const fileList = await Promise.all(files.map(async (file) => {
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        return {
            name: file,
            isDir: stat.isDirectory(),
            size: stat.size,
        };
    }));

    const html = generateDirectoryHtml(req.path, fileList);
    res.type('html').send(html);
}

function generateDirectoryHtml(currentPath: string, files: Array<{ name: string, isDir: boolean, size: number }>) {
    const items = files.map(file => {
        const encodedName = encodeURIComponent(file.name);
        const href = `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${encodedName}${file.isDir ? '/' : ''}`;
        const size = file.isDir ? '-' : `${formatFileSize(file.size)}`;

        return `<li>
      <a href="${href}">${escapeHtml(file.name)}${file.isDir ? '/' : ''}</a>
      <span>${size}</span>
    </li>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Index of ${escapeHtml(decodeURI(currentPath))}</title>
  <style>
    body { font-family: sans-serif; }
    ul { list-style: none; padding: 0; }
    li { padding: 5px; }
    a { text-decoration: none; color: #0366d6; }
    a:hover { text-decoration: underline; }
    span { float: right; color: #666; }
  </style>
</head>
<body>
  <h1>Index of ${escapeHtml(currentPath)}</h1>
  <hr>
  <ul>${items}</ul>
  <hr>
</body>
</html>`;
}

async function sendFile(req: express.Request, res: express.Response, filePath: string, stat: Stats) {
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const fileSize = stat.size;

    // 处理范围请求
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            res.status(416).header({
                'Content-Range': `bytes */${fileSize}`
            }).send('Range Not Satisfiable');
            return;
        }

        const chunkSize = end - start + 1;
        res.status(206).header({
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mimeType,
        });

        createReadStream(filePath, { start, end }).pipe(res);
    } else {
        res.header({
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        });
        createReadStream(filePath).pipe(res);
    }
}

function handleError(error: NodeJS.ErrnoException, res: express.Response) {
    console.error(error);
    switch (error.code) {
        case 'ENOENT':
            res.status(404).send('File not found');
            break;
        case 'EACCES':
            res.status(403).send('Permission denied');
            break;
        default:
            res.status(500).send('Internal server error');
    }
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}


function checkPathAndAddress(rootPath: string, address: string) {
    //检测路径是否有效
    rootPath = path.resolve(rootPath);
    if (!fsync.existsSync(rootPath)) {   //如果路径不存在
        console.log("Invalid path");    //输出Invalid path
        process.exit(1);    //退出程序  
    }
    //检测address是否有效
    let addressArray = address.split(":");    //将address按照:分割成数组
    if (addressArray.length != 2) {    //如果数组长度不为2
        console.log("Invalid address");    //输出Invalid address
        process.exit(1);    //退出程序
    }
    //检测ip是否有效
    let ip = addressArray[0];    //将ip赋值为数组的第一个元素
    let ipArray = ip.split(".");    //将ip按照.分割成数组
    if (ipArray.length != 4) {    //如果数组长度不为4
        console.log("Invalid ip");    //输出Invalid ip
        process.exit(1);    //退出程序
    }

    for (let i = 0; i < 4; i++) {    //遍历数组
        if (parseInt(ipArray[i]) < 0 || parseInt(ipArray[i]) > 255) {    //如果数组元素小于0或大于255
            console.log("Invalid ip");    //输出Invalid ip
            process.exit(1);    //退出程序
        }
    }
    //检测port是否有效
    let port = addressArray[1];    //将port赋值为数组的第二个元素
    if (parseInt(port) < 0 || parseInt(port) > 65535) {    //如果port小于0或大于65535
        console.log("Invalid port");    //输出Invalid port
        process.exit(1);    //退出程序
    }
    //返回包含有效数据的对象
    return { rootPath: rootPath, ip: ip, port: parseInt(port) };    //返回包含有效数据的对象
}

console.log("address:port, path");

let ip: string = "";
let port: number = 0;
let rootPath: string = "";
if (process.argv.length == 4) {
    let data = checkPathAndAddress(process.argv[3], process.argv[2]);
    rootPath = data.rootPath;
    ip = data.ip;
    port = data.port;
} else if (process.argv.length == 3) {
    let data = checkPathAndAddress(process.cwd(), process.argv[2]);
    rootPath = data.rootPath;
    ip = data.ip;
    port = data.port;

}
else {
    
    let data = checkPathAndAddress("./storage/", "0.0.0.0:8080");
    rootPath = data.rootPath;
    ip = data.ip;
    port = data.port;
}
console.log("rootPath: " + rootPath);
console.log("ip: " + ip);
console.log("port: " + port);

app.listen(port, ip, () => {
    console.log(`Server running at http://${ip}:${port}`);
});