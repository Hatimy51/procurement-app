from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_customers import CustomerCreate, CustomerOut

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _out(c: models.Customer) -> CustomerOut:
    return CustomerOut(
        id=c.id, name=c.name, email=c.email, phone=c.phone,
        site_count=len(c.sites), created_at=c.created_at,
        created_by=c.created_by, updated_by=c.updated_by, updated_at=c.updated_at,
    )


@router.get("", response_model=list[CustomerOut])
def list_customers(db: Session = Depends(get_db)):
    customers = db.query(models.Customer).order_by(models.Customer.name).all()
    return [_out(c) for c in customers]


@router.post("", response_model=CustomerOut)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    customer = models.Customer(name=payload.name, email=payload.email, phone=payload.phone, created_by=user.name)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return _out(customer)


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: str, payload: CustomerCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(404, "Customer not found")
    customer.name = payload.name
    customer.email = payload.email
    customer.phone = payload.phone
    customer.updated_by = user.name
    customer.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(customer)
    return _out(customer)


@router.delete("/{customer_id}")
def delete_customer(customer_id: str, db: Session = Depends(get_db)):
    """
    Only deletable if the customer has no sites yet — a customer with any
    site has (or will have) enquiries, quotes, deliveries, and invoices
    hanging off it, and deleting all of that silently would be far more
    destructive than this simple screen should ever do. A customer added
    by mistake with nothing attached is safe to remove outright.
    """
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(404, "Customer not found")
    if customer.sites:
        raise HTTPException(
            400,
            f"This customer has {len(customer.sites)} site(s) with enquiry history and can't be deleted. "
            "You can still edit their name and contact details.",
        )
    db.delete(customer)
    db.commit()
    return {"deleted": True, "id": customer_id}
