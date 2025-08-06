use anchor_lang::prelude::*;

#[event]
pub struct DepositEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub fee_a: u64,
    pub fee_b: u64,
}

#[event]
pub struct WithdrawEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub fee_a: u64,
    pub fee_b: u64,
    pub percentage: u8,
}

#[event]
pub struct PositionStatusEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub current_price: u64,
    pub in_range: bool,
    pub has_lp: bool,
    pub has_lending: bool,
}

#[event]
pub struct RebalanceEvent {
    pub position_id: u64,
    pub owner: Pubkey,
    pub current_price: u64,
    pub in_range: bool,
    pub action: RebalanceAction,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum RebalanceAction {
    NoAction,
    MoveToLP,
    MoveToLending,
}
