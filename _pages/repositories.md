---
layout: page
permalink: /repositories/
title: Repositories
description:
nav: true
nav_order: 4
---

#### Explore my contributions to Artificial Intelligence on GitHub!

The repositories represent my ongoing commitment to contributing valuable resources to the scientific community, particularly in the realms of computational drug discovery and bioinformatics. Each project is a testament to the power of combining cutting-edge technology with scientific inquiry to address complex challenges in applied artificial intelligence. For more details, please visit my GitHub profile. I invite you to explore these repositories and look forward to any collaboration opportunities or discussions they might inspire.

{% if site.data.repositories.github_users %}

<div class="repositories d-flex flex-wrap flex-md-row flex-column justify-content-center align-items-center">
  {% for user in site.data.repositories.github_users %}
    {% include repository/repo_user.liquid username=user %}
  {% endfor %}
</div>

---

{% if site.repo_trophies.enabled %}
{% for user in site.data.repositories.github_users %}
{% if site.data.repositories.github_users.size > 1 %}

  <h4>{{ user }}</h4>
  {% endif %}
  <div class="repositories d-flex flex-wrap flex-md-row flex-column justify-content-between align-items-center">
  {% include repository/repo_trophies.liquid username=user %}
  </div>

---

{% endfor %}
{% endif %}
{% endif %}

## Notable Repositories

{% if site.data.repositories.github_repos %}

<div class="repositories d-flex flex-wrap flex-md-row flex-column justify-content-between align-items-center">
  {% for repo in site.data.repositories.github_repos %}
    {% include repository/repo.liquid repository=repo %}
  {% endfor %}
</div>
{% endif %}
