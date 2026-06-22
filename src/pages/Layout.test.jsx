import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';

vi.mock('@/components/sync/SyncStatusIndicator', () => ({
  SyncStatusIndicator: () => <button type="button">All synced</button>,
}));

describe('Layout', () => {
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
