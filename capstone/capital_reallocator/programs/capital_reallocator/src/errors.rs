
// errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid price range: min must be less than max")]
    InvalidPriceRange,
    
    #[msg("Invalid position ID")]
    InvalidPositionId,
    
    #[msg("Position is paused")]
    PositionPaused,
    
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Invalid percentage: must be between 1 and 100")]
    InvalidPercentage,
    
    #[msg("Position not empty - withdraw all funds before closing")]
    PositionNotEmpty,
    
    #[msg("Stale price data from oracle")]
    StalePriceData,
    
    #[msg("Batch size too large")]
    BatchTooLarge,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("External protocol error")]
    ExternalProtocolError,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Unauthorized keeper")]
    UnauthorizedKeeper,
    
    #[msg("Position already exists")]
    PositionAlreadyExists,
    
    #[msg("LP position not found")]
    LPPositionNotFound,
    
    #[msg("Lending position not found")]
    LendingPositionNotFound,
}
