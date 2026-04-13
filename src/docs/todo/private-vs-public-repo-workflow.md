- Work only in the private repo: `SideNote2-source`
- Push normal development there:

```bash
git push origin main
```

- Do not do feature work in the public repo: `SideNote2`
- Only update the public repo when you want to publish a release snapshot:

```bash
npm run public-release:publish
```

- `origin` = private repo
- `public` = public repo
