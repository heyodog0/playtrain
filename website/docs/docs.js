const search = document.getElementById('docs-search');
const menuButton = document.getElementById('menu-button');
const sidebar = document.getElementById('docs-sidebar');
const noResults = document.getElementById('no-results');
const navLinks = [...document.querySelectorAll('[data-nav-label]')];
const sectionLinks = [...document.querySelectorAll('.docs-sidebar a[href^="#"], .page-toc a[href^="#"]')];

function closeMenu() {
  document.body.classList.remove('nav-open');
  menuButton?.setAttribute('aria-expanded', 'false');
}

menuButton?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menuButton.setAttribute('aria-expanded', String(open));
});

sidebar?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

search?.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  let visible = 0;

  navLinks.forEach((link) => {
    const match = query === '' || link.textContent.toLowerCase().includes(query);
    link.hidden = !match;
    if (match) visible += 1;
  });

  document.querySelectorAll('.nav-group').forEach((group) => {
    group.hidden = !group.querySelector('[data-nav-label]:not([hidden])');
  });
  noResults.hidden = visible !== 0;
});

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (event.key === '/' && !typing && search && getComputedStyle(search.parentElement).display !== 'none') {
    event.preventDefault();
    search.focus();
  }
  if (event.key === 'Escape') {
    closeMenu();
    if (document.activeElement === search) {
      search.value = '';
      search.dispatchEvent(new Event('input'));
      search.blur();
    }
  }
});

const headings = [...document.querySelectorAll('.docs-content h1[id], .docs-content h2[id]')];
if ('IntersectionObserver' in window && headings.length) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;

    sectionLinks.forEach((link) => {
      link.classList.toggle('active', link.hash === `#${visible.target.id}`);
    });
  }, { rootMargin: '-15% 0px -72% 0px', threshold: 0 });

  headings.forEach((heading) => observer.observe(heading));
}
