const menu = document.querySelector('.menu');
const nav = document.querySelector('nav');
menu?.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  nav.style.display = isOpen ? 'flex' : '';
  nav.style.position = isOpen ? 'absolute' : '';
  nav.style.top = isOpen ? '70px' : '';
  nav.style.left = isOpen ? '0' : '';
  nav.style.right = isOpen ? '0' : '';
  nav.style.padding = isOpen ? '22px 6vw' : '';
  nav.style.background = isOpen ? 'var(--paper)' : '';
  nav.style.flexDirection = isOpen ? 'column' : '';
  menu.setAttribute('aria-expanded', isOpen);
});
