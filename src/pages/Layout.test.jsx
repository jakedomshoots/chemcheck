import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';

vi.mock('@/components/sync/SyncStatusIndicator', () => ({
  SyncStatusIndicator: () => <button type="button">All synced</button>,
}));

describe('Layout', () => {
  it('prioritizes chemical and notes in the mobile tab bar', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Layout currentPageName="Home">
          <div>Route content</div>
        </Layout>
      </MemoryRouter>
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });

    expect(within(primaryNavigation).getByRole('link', { name: /Chemical/i })).toHaveAttribute('href', '/chemicalusage');
    expect(within(primaryNavigation).getByRole('link', { name: /Notes/i })).toHaveAttribute('href', '/notes');
    expect(within(primaryNavigation).queryByRole('link', { name: /Work Orders/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /Route Plan/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More navigation' }));

    const moreDialog = screen.getByRole('dialog', { name: 'More options' });
    expect(within(moreDialog).getByRole('link', { name: /Work Orders/i })).toHaveAttribute('href', '/workorders');
    expect(within(moreDialog).getByRole('link', { name: /Route Plan/i })).toHaveAttribute('href', '/routeoptimizer');
  });

  it('exposes mobile More navigation expanded state to assistive technology', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Layout currentPageName="Home">
          <div>Route content</div>
        </Layout>
      </MemoryRouter>
    );

    const moreButton = screen.getByRole('button', { name: 'More navigation' });

    expect(moreButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(moreButton);

    expect(moreButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'More options' })).toBeInTheDocument();
  });
});
