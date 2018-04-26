const { promisify } = require('util');
const { parse } = require('node-html-parser');
const axios = require('axios');
require('dotenv').config();

const HTML_HEADER = { Accept: 'application/vnd.github.v3.html' };
const JSON_HEADER = { Accept: 'application/vnd.github.v3+json' };

const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    Authorization: `token ${process.env.TOKEN}`
  }
});

github.interceptors.response.use(
  res => res,
  err => {
    console.error(err.message);
    err.response && console.error(err.response.data.message);
  }
);

const log = arr => {
  console.log(arr);
  return arr;
};

const githubURL = (owner, repo, branch = 'master') =>
  `https://github.com/${owner}/${repo}/blob/${branch}`;

const fetchMarkdownPaths = (owner, repo, tree_sha = 'master') =>
  github({
    url: `/repos/${owner}/${repo}/git/trees/${tree_sha}?recursive=1`,
    headers: JSON_HEADER
  }).then(({ data }) =>
    data.tree
      .filter(({ path, type }) => type === 'blob' && path.endsWith('.md'))
      .map(({ path }) => path)
  );

const downloadFiles = (owner, repo) => paths =>
  Promise.all(
    paths.map(path =>
      github({
        url: `/repos/${owner}/${repo}/contents/${path}`,
        headers: HTML_HEADER,
        responseType: 'text',
        transformResponse: undefined
      }).then(({ data }) => ({ contents: data, path }))
    )
  );

const parseLinks = baseUrl => files =>
  files.map(({ path, contents }) => ({
    file: path,
    links: parse(contents)
      .querySelectorAll('a')
      .map(el => el.attributes.href)
      .filter(
        href => href && !href.startsWith('#') && !href.startsWith('mailto')
      )
      .map(
        href =>
          href.startsWith('./')
            ? `${baseUrl}/${path
                .split('/')
                .slice(0, -1)
                .join('/')}/${href.substring(2)}`
            : href
      )
  }));

const getLinkStatus = url =>
  axios({ url, transformResponse: undefined })
    .then(({ status }) => ({ status, url }))
    .catch(err => ({
      status: (err.response && err.response.status) || err.code,
      url
    }));

const verifyLinks = files =>
  Promise.all(
    files.map(({ file, links }) =>
      Promise.all(links.map(url => getLinkStatus(url))).then(resolvedLinks => ({
        file,
        links: resolvedLinks.filter(({ status }) => status !== 200)
      }))
    )
  );

const filterSuccessfulFiles = files =>
  files.filter(({ links }) => links.length !== 0);

// 1. Fetch markdown paths
// 2. Get markdown contents from render api
// 3. Parse links from html
// 4. Follow links and check for valid response codes
const validateGithubLinks = (owner, repo) =>
  fetchMarkdownPaths(owner, repo)
    .then(downloadFiles(owner, repo))
    .then(parseLinks(githubURL(owner, repo)))
    .then(verifyLinks)
    .then(filterSuccessfulFiles)
    .then(x => JSON.stringify(x, null, 2))
    .then(log)
    .catch(err => console.error(err.stack ? err : err.message));

validateGithubLinks('linkedin', 'css-blocks');
