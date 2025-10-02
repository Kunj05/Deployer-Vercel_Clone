const express = require('express');
const httpProxy = require('http-proxy');
require('dotenv').config();

const app = express();
const port = process.env.PORT;
const Base_Path = process.env.BASE_PATH //"https://bucket_name.s3.amazonaws.com/_outputs/"

const proxy = httpProxy.createProxy();

app.use((req, res) => {
    const hostname = req.hostname; //full hostname
    const subdomain = hostname.split('.')[0]; //slug_name

    console.log(`Subdomain: ${subdomain}, Path: ${req.url}`);

    const resolvesTo = `${Base_Path}/${subdomain}`;
    
    proxy.web(req, res, { target: resolvesTo, changeOrigin: true }, (err) => {
        console.error(`Error proxying request: ${err.message}`);
        res.status(500).send('Something went wrong while proxying the request.');
    });
});

proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url;
    if (url === '/') {
        proxyReq.path += 'index.html'; 
    }
});

proxy.on('error', (err, req, res) => {
    console.error(`Proxy Error: ${err.message}`);
    res.status(502).send('Proxy failed.');
});

app.listen(port, () => console.log(`Reverse Proxy running on port ${port}`));

//
//  a1.vercel.com -> https://bucket_name.s3.amazonaws.com/_outputs/{builder_id}/index.html
//
//
