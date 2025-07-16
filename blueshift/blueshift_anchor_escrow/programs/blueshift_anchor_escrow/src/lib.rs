use anchor_lang::prelude::*;

declare_id!("E76A5sNFkWcoGLhhCmfNDF5BGDKGTXmKYvJfZHhkT4xR");

#[program]
pub mod blueshift_anchor_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
