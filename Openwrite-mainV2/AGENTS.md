# OpenWrite workspace instructions

- Use `~/my_novel` as the only project for manual, live-server, and browser QA.
- Do not create or open temporary novel projects for manual QA. Extend `~/my_novel`
  with any fixtures needed to exercise new features.
- Automated pytest cases may use isolated temporary directories, but must inject an
  isolated `ProjectRegistry` and must never write those paths to the user's default
  recent-project registry.
- The OpenWrite framework repository and `reference/my_novel` are not active novel
  projects.
