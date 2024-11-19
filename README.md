
# Vercel Clone - Project Overview

This project is a **Vercel clone** designed to replicate the functionalities of Vercel, a cloud platform for static sites and serverless functions. The clone uses a combination of **Node.js**, **Docker**, **Redis**, **AWS**, and other modern technologies to create a scalable and performant cloud architecture. The main focus of this project is to ensure **high concurrency handling**, **API optimization**, and **seamless deployment** across cloud environments, similar to the production-ready architecture of Vercel.

### Setup Guide

This Project contains following services and folders:

- `api-server`: HTTP API Server for REST API's
- `build-server`: Docker Image code which clones, builds and pushes the build to S3
- `s3-reverse-proxy`: Reverse Proxy the subdomains and domains to s3 bucket static assets

### Local Setup

1. Run `npm install` in all the 3 services i.e. `api-server`, `build-server` and `s3-reverse-proxy`
2. Docker build the `build-server` and push the image to AWS ECR.
3. Setup the `api-server` by providing all the required config such as TASK ARN and CLUSTER arn.
4. Run `node index.js` in `api-server` and `s3-reverse-proxy`


### Architecture

![Vercel Clone Architecture](https://i.imgur.com/r7QUXqZ.png)