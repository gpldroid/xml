/**
 * Blogger Dev Architect
 * ----------------------
 * Main frontend JavaScript.
 *
 * Dependency-free browser code for the generated Blogger theme.
 * The build pipeline injects this file before the closing body tag.
 */

(() => {
  'use strict';

  const init = () => {
    setupMobileNavigation();
    setupSmoothScrolling();
    setupBackToTop();
    setupCurrentYear();
    setupLoadedState();
  };

  /**
   * Controls the responsive navigation menu and keeps its
   * accessibility state synchronized with the UI.
   */
  const setupMobileNavigation = () => {
    const menuToggle = document.querySelector('.menu-toggle');
    const navigation = document.querySelector('.site-navigation');

    if (!menuToggle || !navigation) {
      return;
    }

    const closeMenu = () => {
      navigation.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('menu-open');
    };

    const toggleMenu = () => {
      const isOpen = navigation.classList.toggle('is-open');

      menuToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('menu-open', isOpen);
    };

    menuToggle.addEventListener('click', toggleMenu);

    navigation.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) {
        closeMenu();
      }
    });
  };

  /**
   * Adds accessible smooth scrolling for same-page anchor links.
   */
  const setupSmoothScrolling = () => {
    const links = document.querySelectorAll('a[href^="#"]');

    if (!links.length) {
      return;
    }

    links.forEach((link) => {
      link.addEventListener('click', (event) => {
        const targetId = link.getAttribute('href');

        if (!targetId || targetId === '#') {
          return;
        }

        const target = document.querySelector(targetId);

        if (!target) {
          return;
        }

        event.preventDefault();

        const reducedMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)'
        ).matches;

        target.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    });
  };

  /**
   * Shows the back-to-top control after the visitor scrolls down.
   */
  const setupBackToTop = () => {
    const button = document.querySelector('.back-to-top');

    if (!button) {
      return;
    }

    const updateVisibility = () => {
      const shouldShow = window.scrollY > 400;

      button.classList.toggle('is-visible', shouldShow);
      button.setAttribute('aria-hidden', String(!shouldShow));
    };

    const scrollToTop = () => {
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      window.scrollTo({
        top: 0,
        behavior: reducedMotion ? 'auto' : 'smooth'
      });
    };

    button.addEventListener('click', scrollToTop);
    window.addEventListener('scroll', updateVisibility, { passive: true });

    updateVisibility();
  };

  /**
   * Keeps the copyright year current without requiring
   * another source-file change every calendar year.
   */
  const setupCurrentYear = () => {
    const yearElements = document.querySelectorAll('.current-year');

    if (!yearElements.length) {
      return;
    }

    const currentYear = new Date().getFullYear();

    yearElements.forEach((element) => {
      element.textContent = String(currentYear);
    });
  };

  /**
   * Adds a small loaded state after the initial DOM render.
   */
  const setupLoadedState = () => {
    window.requestAnimationFrame(() => {
      document.documentElement.classList.add('is-loaded');
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
