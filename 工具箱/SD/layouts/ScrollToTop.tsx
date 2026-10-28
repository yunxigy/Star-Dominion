import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Keep route navigation focused on the beginning of the newly opened page. */
export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, search]);

  return null;
}

export default ScrollToTop;
